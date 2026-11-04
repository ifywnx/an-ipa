#!/usr/bin/env python3
"""macOS trusted-verifier worker for AN IPA STORE — READY TO RUN, NOT YET RUN.

Run this ONLY on a Mac with Xcode Command Line Tools. It uses Apple's own
tools to verify an already-quarantined, owner-signed IPA:

  * `codesign --verify --deep --strict` on the .app (covers nested code);
  * `codesign -dvvv` per nested component for Team ID cross-checks;
  * `codesign -d --entitlements` compared against the profile entitlements;
  * `security cms -D` to decode the provisioning profile;
  * `security verify-cert` on the extracted signing certificate chain,
    including an OCSP revocation attempt.

Output is one JSON document matching the server attestation schema
(src/modules/ota/verifier.ts / verifier_attestations table). The verifier
NEVER grants installation by itself (`install_eligible` is always false in
its output); the server policy re-checks this evidence together with the
device, profile and release-gate records.

On a non-macOS host the tool refuses to run (exit 2, MACOS_REQUIRED):
embedded-metadata inspection stays with workers/ipa_inspector.py there.
The owner signs with LCSign on iPhone; this worker verifies only and never
handles a P12 or private key.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ipa_inspector import InspectionError, inspect_ipa  # noqa: E402

VERIFIER_ID = "an-ipa-macos-verifier/1.0"
TOOL_TIMEOUT = 120


class VerifyError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _run(argv: list[str], timeout: int = TOOL_TIMEOUT) -> subprocess.CompletedProcess:
    return subprocess.run(
        argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=timeout, check=False,
    )


def _text(data: bytes) -> str:
    return data.decode("utf-8", "replace")


# --------------------------------------------------------------------------
# Pure output parsers (unit-tested with recorded fixtures; no Mac required).
# --------------------------------------------------------------------------

def parse_codesign_info(text: str) -> dict:
    """Parse `codesign -dvvv` key=value output for one binary."""
    info: dict = {"identifier": None, "team_id": None, "authorities": [],
                  "flags": None, "signed": False}
    for line in text.splitlines():
        if line.startswith("Identifier="):
            info["identifier"] = line.split("=", 1)[1].strip()
        elif line.startswith("TeamIdentifier="):
            value = line.split("=", 1)[1].strip()
            info["team_id"] = None if value in ("", "not set") else value
        elif line.startswith("Authority="):
            info["authorities"].append(line.split("=", 1)[1].strip())
        elif line.startswith("CodeDirectory"):
            match = re.search(r"flags=0x([0-9a-fA-F]+)", line)
            if match:
                info["flags"] = match.group(1)
    info["signed"] = bool(info["identifier"]) and info["team_id"] is not None
    return info


def parse_codesign_verify_ok(returncode: int, text: str) -> bool:
    """codesign --verify succeeds silently (rc 0); any complaint fails."""
    if returncode != 0:
        return False
    lowered = text.lower()
    markers = ("invalid", "failed", "not signed", "not signed at all")
    return not any(marker in lowered for marker in markers)


def parse_openssl_enddate(text: str) -> str | None:
    """Parse `openssl x509 -enddate` output into an ISO-8601 UTC string."""
    for line in text.splitlines():
        if line.startswith("notAfter="):
            raw = line.split("=", 1)[1].strip()
            try:
                parsed = datetime.strptime(raw, "%b %d %H:%M:%S %Y %Z")
            except ValueError:
                return None
            return parsed.replace(tzinfo=timezone.utc).isoformat()
    return None


def parse_verify_cert(returncode: int, text: str) -> dict:
    """Interpret `security verify-cert` output conservatively."""
    lowered = text.lower()
    if "revoked" in lowered:
        return {"chain_valid": False, "revoked": True, "revocation_check": "revoked"}
    if returncode == 0:
        return {"chain_valid": True, "revoked": False, "revocation_check": "ok"}
    return {"chain_valid": False, "revoked": False, "revocation_check": "unavailable"}


def entitlements_match(app_entitlements: dict, profile: dict, bundle_id: str) -> bool:
    """App entitlements must be a faithful subset of the profile's grant."""
    profile_entitlements = profile.get("Entitlements")
    if not isinstance(profile_entitlements, dict) or not isinstance(app_entitlements, dict):
        return False
    app_identifier = app_entitlements.get("application-identifier")
    profile_identifier = profile_entitlements.get("application-identifier")
    if not isinstance(app_identifier, str) or not isinstance(profile_identifier, str):
        return False
    if not app_identifier.endswith("." + bundle_id):
        return False
    if profile_identifier != app_identifier and not profile_identifier.endswith(".*"):
        return False
    if app_entitlements.get("get-task-allow") is True:
        return False
    for key, value in app_entitlements.items():
        if key == "application-identifier":
            continue
        if key not in profile_entitlements:
            return False
        granted = profile_entitlements[key]
        if isinstance(value, list):
            if not isinstance(granted, list) or not set(value) <= set(granted):
                return False
        elif granted != value and granted is not True:
            return False
    return True


# --------------------------------------------------------------------------
# Tool orchestration (macOS only).
# --------------------------------------------------------------------------

def _require_macos() -> None:
    if sys.platform != "darwin":
        raise VerifyError("MACOS_REQUIRED")
    for tool in ("codesign", "security", "openssl"):
        if shutil.which(tool) is None:
            raise VerifyError("REQUIRED_TOOL_MISSING:" + tool)


def _extract_app(ipa_path: Path, destination: Path) -> Path:
    with zipfile.ZipFile(ipa_path, "r") as archive:
        apps = set()
        for name in archive.namelist():
            parts = name.split("/")
            if len(parts) >= 2 and parts[0] == "Payload" and parts[1].endswith(".app"):
                apps.add(parts[1])
            if name.startswith("/") or ".." in parts:
                raise VerifyError("UNSAFE_ARCHIVE_PATH")
        if len(apps) != 1:
            raise VerifyError("APP_ROOT_NOT_UNIQUE")
        app_name = next(iter(apps))
        for info in archive.infolist():
            target = destination / info.filename
            if not str(target.resolve()).startswith(str(destination.resolve())):
                raise VerifyError("UNSAFE_ARCHIVE_PATH")
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as source, target.open("wb") as sink:
                    shutil.copyfileobj(source, sink, 1024 * 1024)
    return destination / "Payload" / app_name


def _codesign_info(binary: Path) -> dict:
    result = _run(["codesign", "-dvvv", str(binary)])
    return parse_codesign_info(_text(result.stderr) + _text(result.stdout))


def _entitlements(binary: Path) -> dict:
    result = _run(["codesign", "-d", "--entitlements", ":-", str(binary)])
    raw = result.stdout
    if not raw:
        return {}
    try:
        value = plistlib.loads(raw)
    except (ValueError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


def _decode_profile(app_dir: Path, override: Path | None, workdir: Path) -> dict:
    source = override or (app_dir / "embedded.mobileprovision")
    if not source.is_file():
        raise VerifyError("PROFILE_NOT_FOUND")
    decoded = workdir / "profile.plist"
    result = _run(["security", "cms", "-D", "-i", str(source), "-o", str(decoded)])
    if result.returncode != 0 or not decoded.is_file():
        raise VerifyError("PROFILE_CMS_DECODE_FAILED")
    try:
        value = plistlib.loads(decoded.read_bytes())
    except (ValueError, TypeError) as exc:
        raise VerifyError("PROFILE_PLIST_INVALID") from exc
    if not isinstance(value, dict):
        raise VerifyError("PROFILE_PLIST_INVALID")
    return value


def _certificate_evidence(app_dir: Path, workdir: Path) -> dict:
    prefix = workdir / "cert"
    _run(["codesign", "-d", "--extract-certificates", str(prefix), str(app_dir)])
    leaf = Path(str(prefix) + "0")
    if not leaf.is_file():
        return {"signing_certificate_expires_at": None, "chain_valid": False,
                "revoked": False, "revocation_check": "unavailable"}
    enddate = _run(["openssl", "x509", "-inform", "DER", "-in", str(leaf),
                    "-noout", "-enddate"])
    expires_at = parse_openssl_enddate(_text(enddate.stdout))
    chain_files = sorted(
        Path(str(prefix) + str(index)) for index in range(4)
        if Path(str(prefix) + str(index)).is_file()
    )
    argv = ["security", "verify-cert", "-p", "codesigning"]
    for cert in chain_files:
        argv += ["-c", str(cert)]
    plain = _run(argv)
    verdict = parse_verify_cert(plain.returncode, _text(plain.stdout) + _text(plain.stderr))
    if verdict["revocation_check"] == "ok":
        ocsp = _run(argv + ["-R", "ocsp"])
        verdict = parse_verify_cert(ocsp.returncode, _text(ocsp.stdout) + _text(ocsp.stderr))
        if verdict["revocation_check"] == "unavailable":
            # OCSP could not be evaluated; keep the plain chain verdict but
            # record that revocation was not independently confirmed.
            verdict = {"chain_valid": plain.returncode == 0, "revoked": False,
                       "revocation_check": "unavailable"}
    return {"signing_certificate_expires_at": expires_at, **verdict}


def verify_artifact(ipa_path: Path, profile_override: Path | None = None) -> dict:
    _require_macos()
    if not ipa_path.is_file() or ipa_path.suffix.lower() != ".ipa":
        raise VerifyError("INVALID_IPA_PATH")
    try:
        inspected = inspect_ipa(ipa_path)
    except InspectionError as exc:
        raise VerifyError(exc.code) from exc

    sha = hashlib.sha256(ipa_path.read_bytes()).hexdigest()
    verified_at = datetime.now(timezone.utc).isoformat()
    base = {
        "verifier_id": VERIFIER_ID,
        "verified_at": verified_at,
        "artifact_sha256": sha,
        "bundle_id": inspected["bundle_id"],
        "install_eligible": False,
        "verification_scope": "apple_codesign_tools_on_macos",
    }

    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        app_dir = _extract_app(ipa_path, workdir / "extract")
        profile = _decode_profile(app_dir, profile_override, workdir)

        verify_run = _run(["codesign", "--verify", "--deep", "--strict",
                           "--verbose=2", str(app_dir)])
        signature_verified = parse_codesign_verify_ok(
            verify_run.returncode, _text(verify_run.stderr) + _text(verify_run.stdout))

        # Per-component Team cross-check against the inspector inventory.
        nested = inspected.get("nested_code", {})
        main_team: str | None = None
        nested_present = True
        nested_match = True
        for component in nested.get("components", []):
            binary = workdir / "extract" / component["path"]
            info = _codesign_info(binary) if binary.is_file() else {"signed": False, "team_id": None}
            if component.get("kind") == "executable":
                main_team = info["team_id"]
            if not info["signed"]:
                nested_present = False
            elif main_team is not None and info["team_id"] != main_team:
                nested_match = False
        if not nested.get("components"):
            nested_present = False
            nested_match = False

        profile_entitlements = profile.get("Entitlements") or {}
        profile_app_id = profile_entitlements.get("application-identifier")
        profile_bundle = (profile_app_id.split(".", 1)[1]
                          if isinstance(profile_app_id, str) and "." in profile_app_id else None)
        info_plist = plistlib.loads((app_dir / "Info.plist").read_bytes())
        executable = info_plist.get("CFBundleExecutable")
        app_entitlements = _entitlements(app_dir / executable) if executable else {}
        cert = _certificate_evidence(app_dir, workdir)

        profile_expires = profile.get("ExpirationDate")
        team_list = profile.get("TeamIdentifier") or []
        return {
            **base,
            "signature_verified": bool(signature_verified and cert["chain_valid"]),
            "nested_signatures_present": bool(nested_present),
            "nested_team_matches": bool(nested_match and nested_present),
            "dylib_dependencies_resolved": bool(nested.get("dependencies_resolved")),
            "artifact_team_id": main_team,
            "profile_team_id": team_list[0] if team_list else None,
            "profile_bundle_id": profile_bundle,
            "profile_expires_at": (profile_expires.isoformat()
                                    if isinstance(profile_expires, datetime) else None),
            "profile_type": inspected["profile"]["profile_type"],
            "provisions_all_devices": profile.get("ProvisionsAllDevices") is True,
            "entitlements_match": entitlements_match(
                app_entitlements, profile, inspected["bundle_id"]),
            "signing_certificate_expires_at": cert["signing_certificate_expires_at"],
            "signing_certificate_revoked": bool(cert["revoked"]),
            "certificate_chain_valid": bool(cert["chain_valid"]),
            "revocation_check": cert["revocation_check"],
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="AN IPA STORE macOS verifier")
    parser.add_argument("--ipa", required=True, help="Quarantined .ipa to verify")
    parser.add_argument("--profile", help="Optional standalone .mobileprovision override")
    parser.add_argument("--out", help="Write evidence JSON to this path instead of stdout")
    args = parser.parse_args()
    try:
        evidence = verify_artifact(
            Path(args.ipa), Path(args.profile) if args.profile else None)
    except VerifyError as exc:
        print(json.dumps({"status": "rejected", "error": exc.code}))
        return 2
    rendered = json.dumps(evidence, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
