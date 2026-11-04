#!/usr/bin/env python3
"""Standalone provisioning-profile intake for the Admin evidence pipeline.

Takes ONE .mobileprovision file (already received through the private
intake/quarantine path), verifies the CMS *content integrity* with OpenSSL
and extracts the metadata the OTA evidence adapter needs: Team ID, App ID /
bundle, provisioned UDIDs, expiry and profile type.

Trust boundary, identical to ipa_inspector: `-noverify` is deliberate. The
output is UNTRUSTED metadata for Admin review and for the server-side
evidence record. It never proves Apple signed the profile, never sets any
signature-verification evidence and always reports
apple_signer_chain_trusted=false and install_eligible=false. Only the
macOS verifier (workers/macos-verifier) can raise trust, and only after it
has actually run on a Mac.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from ipa_inspector import InspectionError, MAX_PROFILE, _plist

MAX_PROVISIONED_DEVICES = 1000
_UDID_LEGACY = re.compile(r"^[0-9A-F]{40}$")
_UDID_MODERN = re.compile(r"^[0-9A-F]{8}-[0-9A-F]{16}$")


def _cms_payload(signed_cms: bytes) -> bytes:
    """OpenSSL checks CMS message integrity, but NO issuer/chain trust."""
    if not 64 <= len(signed_cms) <= MAX_PROFILE:
        raise InspectionError("INVALID_PROFILE_SIZE")
    try:
        result = subprocess.run(
            ["openssl", "cms", "-verify", "-noverify", "-inform", "DER", "-binary"],
            input=signed_cms, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=8, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise InspectionError("PROFILE_CMS_UNAVAILABLE") from exc
    if result.returncode != 0 or len(result.stdout) > MAX_PROFILE:
        raise InspectionError("PROFILE_CMS_INTEGRITY_FAILED")
    return result.stdout


def _canonical_udid(value: object) -> str:
    if not isinstance(value, str):
        raise InspectionError("PROFILE_DEVICES_INVALID")
    candidate = value.strip().upper()
    if _UDID_LEGACY.fullmatch(candidate) or _UDID_MODERN.fullmatch(candidate):
        return candidate
    raise InspectionError("PROFILE_DEVICES_INVALID")


def extract_profile_evidence(signed_cms: bytes) -> dict:
    """Extract profile evidence or raise InspectionError with a stable code.

    Unlike the IPA inspector, an expired profile is NOT rejected here: the
    expiry is evidence (the OTA policy denies expired profiles), so it is
    recorded faithfully with `expired` set instead of being hidden.
    """
    profile = _plist(_cms_payload(signed_cms))

    uuid_value = profile.get("UUID")
    if not isinstance(uuid_value, str) or not 1 <= len(uuid_value) <= 64:
        raise InspectionError("PROFILE_UUID_INVALID")

    expires = profile.get("ExpirationDate")
    if not isinstance(expires, datetime):
        raise InspectionError("PROFILE_EXPIRY_MISSING")
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)

    team = profile.get("TeamIdentifier")
    if (not isinstance(team, list) or not team or
            any(not isinstance(t, str) or not t or len(t) > 64 for t in team)):
        raise InspectionError("PROFILE_TEAM_INVALID")

    entitlements = profile.get("Entitlements")
    if not isinstance(entitlements, dict):
        raise InspectionError("PROFILE_ENTITLEMENTS_MISSING")
    application_identifier = entitlements.get("application-identifier")
    if (not isinstance(application_identifier, str) or "." not in application_identifier):
        raise InspectionError("PROFILE_APPLICATION_ID_INVALID")
    app_id_prefix, _, bundle_suffix = application_identifier.partition(".")
    if not app_id_prefix or not bundle_suffix:
        raise InspectionError("PROFILE_APPLICATION_ID_INVALID")
    bundle_wildcard = bundle_suffix == "*"
    bundle_id = None if bundle_wildcard else bundle_suffix

    raw_devices = profile.get("ProvisionedDevices")
    if raw_devices is None:
        provisioned_udids: list[str] = []
    elif isinstance(raw_devices, list) and len(raw_devices) <= MAX_PROVISIONED_DEVICES:
        provisioned_udids = [_canonical_udid(value) for value in raw_devices]
    else:
        raise InspectionError("PROFILE_DEVICES_INVALID")

    provisions_all = profile.get("ProvisionsAllDevices") is True
    get_task_allow = entitlements.get("get-task-allow") is True
    if provisions_all:
        profile_type = "enterprise"
    elif get_task_allow:
        profile_type = "development"
    elif isinstance(raw_devices, list):
        profile_type = "ad_hoc"
    else:
        profile_type = "unknown"

    return {
        "uuid": uuid_value,
        "team_id": team[0],
        "team_ids": list(team),
        "application_identifier": application_identifier,
        "bundle_id": bundle_id,
        "bundle_wildcard": bundle_wildcard,
        "profile_type": profile_type,
        "provisions_all_devices": provisions_all,
        "provisioned_udids": provisioned_udids,
        "provisioned_device_count": len(provisioned_udids),
        "expires_at": expires.isoformat(),
        "expired": expires <= datetime.now(timezone.utc),
        "get_task_allow": get_task_allow,
        "cms_content_integrity": True,
        "apple_signer_chain_trusted": False,
        "evidence_source": "profile_intake_untrusted_metadata",
        "install_eligible": False,
    }


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"status": "rejected", "error": "INVALID_USAGE"}))
        return 2
    path = Path(sys.argv[1])
    if path.suffix.lower() != ".mobileprovision" or not path.is_file():
        print(json.dumps({"status": "rejected", "error": "INVALID_PROFILE_PATH"}))
        return 2
    try:
        evidence = extract_profile_evidence(path.read_bytes())
        print(json.dumps(evidence, ensure_ascii=False))
        return 0
    except InspectionError as exc:
        print(json.dumps({"status": "rejected", "error": exc.code}))
        return 2
    except (OSError, ValueError, UnicodeError):
        print(json.dumps({"status": "rejected", "error": "INVALID_PROFILE_FILE"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
