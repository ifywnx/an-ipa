#!/usr/bin/env python3
"""Offline, fail-closed IPA metadata inspector (NO IPA signing, NO OTA grants).

Run only in a sandboxed worker on a privately quarantined file. This module
does not expose an upload endpoint or mark an archive cryptographically trusted.
Uses Python stdlib + OpenSSL for CMS *integrity* only, never trusts signers.
"""
from __future__ import annotations

import hashlib
import json
import os
import plistlib
import re
import stat
import struct
import subprocess
import sys
import zipfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

MAX_IPA_BYTES = 500 * 1024 * 1024
MAX_MEMBERS = 20_000
MAX_TOTAL_UNCOMPRESSED = 2 * 1024 * 1024 * 1024
MAX_RATIO = 300
MAX_PLIST = 1024 * 1024
MAX_PROFILE = 1024 * 1024

# --- Nested Mach-O inventory (embedded signature *metadata* only) -----------
# Every IPA on this store is a dylib-injected (tweaked) build, so the archive
# scan must inventory every nested executable, read the Team ID embedded in
# each CodeDirectory blob and check dylib load references. This parses the
# *declaration* inside the file; it does NOT verify hashes, CMS signatures or
# the Apple chain. It is never a substitute for `codesign --verify` on a
# trusted macOS worker (see docs/IPA_INSPECTION.md).
MAX_MACHO_BYTES = 256 * 1024 * 1024
MAX_NESTED_COMPONENTS = 256
MAX_UNRESOLVED_DEPS = 32

_LC_CODE_SIGNATURE = 0x1D
_LC_RPATH = 0x1C00001C
_DYLIB_LOAD_COMMANDS = {0x0C, 0x0D, 0x20, 0x23, 0x1F, 0x80000018}
_CSMAGIC_EMBEDDED_SIGNATURE = 0xFADE0CC0
_CSMAGIC_CODEDIRECTORY = 0xFADE0C02
_CSSLOT_CODEDIRECTORY = 0

NESTED_ISSUE_CODES = (
    "NESTED_SIGNATURE_MISSING",
    "NESTED_SIGNATURE_UNREADABLE",
    "NESTED_TEAM_MISMATCH",
    "NESTED_CODE_UNREADABLE",
    "DYLIB_UNRESOLVED_DEPENDENCY",
)


class InspectionError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _check_members(archive: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    entries = archive.infolist()
    if len(entries) == 0 or len(entries) > MAX_MEMBERS:
        raise InspectionError("INVALID_ENTRY_COUNT")
    names: dict[str, zipfile.ZipInfo] = {}
    total = 0
    for item in entries:
        name = item.filename
        parts = name.split("/")
        if (not name or name.startswith("/") or "\\" in name or "\x00" in name
                or ":" in name or any(p in (".", "..") for p in parts)
                or any(p == "" for p in parts[:-1])
                or any(ord(char) < 32 for char in name)
                or len(name) > 1024):
            raise InspectionError("UNSAFE_ARCHIVE_PATH")
        canonical = unicodedata.normalize("NFC", name.rstrip("/")).casefold()
        if canonical in names:
            raise InspectionError("DUPLICATE_ARCHIVE_PATH")
        mode = stat.S_IFMT(item.external_attr >> 16)
        if mode not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise InspectionError("UNSAFE_ARCHIVE_FILE_TYPE")
        if item.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise InspectionError("UNSUPPORTED_ZIP_COMPRESSION")
        if item.flag_bits & 1:
            raise InspectionError("ENCRYPTED_ARCHIVE_MEMBER")
        if item.file_size < 0 or item.compress_size < 0:
            raise InspectionError("INVALID_MEMBER_SIZE")
        total += item.file_size
        if total > MAX_TOTAL_UNCOMPRESSED:
            raise InspectionError("ZIP_DECOMPRESSION_LIMIT")
        if (item.file_size > 1024 * 1024 and
                item.file_size / max(1, item.compress_size) > MAX_RATIO):
            raise InspectionError("ZIP_COMPRESSION_RATIO")
        names[canonical] = item
    return names


def _verify_archive_streams(archive: zipfile.ZipFile, members: dict) -> None:
    """Read every member to validate CRC and actual size, without extraction."""
    total = 0
    for item in members.values():
        if item.is_dir():
            continue
        actual = 0
        try:
            with archive.open(item) as stream:
                while True:
                    block = stream.read(65536)
                    if not block:
                        break
                    actual += len(block)
                    total += len(block)
                    if actual > item.file_size or total > MAX_TOTAL_UNCOMPRESSED:
                        raise InspectionError("ZIP_DECOMPRESSION_LIMIT")
        except (zipfile.BadZipFile, RuntimeError, EOFError, OSError) as exc:
            raise InspectionError("ARCHIVE_READ_FAILED") from exc
        if actual != item.file_size:
            raise InspectionError("ARCHIVE_SIZE_MISMATCH")


def _read_limited(archive: zipfile.ZipFile, item: zipfile.ZipInfo, maximum: int) -> bytes:
    if item.file_size > maximum:
        raise InspectionError("METADATA_TOO_LARGE")
    try:
        with archive.open(item) as opened:
            data = opened.read(maximum + 1)
    except (RuntimeError, EOFError, OSError, zipfile.BadZipFile) as exc:
        raise InspectionError("ARCHIVE_READ_FAILED") from exc
    if len(data) > maximum or len(data) != item.file_size:
        raise InspectionError("INVALID_METADATA_SIZE")
    return data


def _plist(data: bytes) -> dict:
    try:
        value = plistlib.loads(data)
    except (ValueError, TypeError, OverflowError, OSError, plistlib.InvalidFileException) as exc:
        raise InspectionError("MALFORMED_PLIST") from exc
    if not isinstance(value, dict):
        raise InspectionError("INVALID_PLIST_ROOT")
    return value


def _cd_team_id(data: bytes, offset: int, size: int) -> str | None:
    """Read the Team ID string declared in an embedded CodeDirectory blob.

    Metadata only: blob hashes are not checked and the CMS signature over the
    CodeDirectory is not verified, so this value is an untrusted claim.
    """
    try:
        if offset < 0 or size < 52 or offset + size > len(data):
            return None
        blob = data[offset:offset + size]
        magic, length, version = struct.unpack_from(">III", blob, 0)
        if magic != _CSMAGIC_CODEDIRECTORY or not 52 <= length <= size:
            return None
        if version < 0x20100:
            return None  # CodeDirectory predates the team_id field.
        (team_offset,) = struct.unpack_from(">I", blob, 48)
        if not 0 < team_offset < length:
            return None
        end = blob.find(b"\x00", team_offset, length)
        if end < 0:
            return None
        team = blob[team_offset:end].decode("ascii")
        return team if re.fullmatch(r"[A-Za-z0-9-]{1,64}", team) else None
    except (struct.error, UnicodeDecodeError):
        return None


def _signature_team(data: bytes, offset: int, size: int) -> str | None:
    """Locate the primary CodeDirectory inside a signature superblob."""
    try:
        if offset < 0 or size < 12 or offset + size > len(data):
            return None
        magic, length, count = struct.unpack_from(">III", data, offset)
        if magic != _CSMAGIC_EMBEDDED_SIGNATURE or not 12 <= length <= size or count > 64:
            return None
        for index in range(count):
            entry = offset + 12 + index * 8
            if entry + 8 > offset + length:
                return None
            blob_type, blob_offset = struct.unpack_from(">II", data, entry)
            if blob_type != _CSSLOT_CODEDIRECTORY:
                continue
            if blob_offset + 4 > length:
                return None
            (blob_size,) = struct.unpack_from(">I", data, offset + blob_offset + 4)
            return _cd_team_id(data, offset + blob_offset, blob_size)
        return None
    except struct.error:
        return None


def _parse_macho_slice(data: bytes) -> dict:
    """Parse one thin Mach-O slice: load dylib/rpath names + signature claim.

    Raises ValueError on any structural problem; callers record the component
    as unreadable instead of trusting partial output.
    """
    if len(data) < 28:
        raise ValueError("short")
    (magic,) = struct.unpack_from("<I", data, 0)
    if magic == 0xFEEDFACF:
        header_size = 32
    elif magic == 0xFEEDFACE:
        header_size = 28
    else:
        raise ValueError("not_macho")
    ncmds, sizeofcmds = struct.unpack_from("<II", data, 16)
    if ncmds > 512 or header_size + sizeofcmds > len(data):
        raise ValueError("bad_commands")
    loads: list[str] = []
    rpaths: list[str] = []
    signature: tuple[int, int] | None = None
    pos = header_size
    commands_end = header_size + sizeofcmds

    def _string_at(start: int, limit: int) -> str:
        end = data.find(b"\x00", start, limit)
        if end < 0:
            raise ValueError("unterminated_string")
        return data[start:end].decode("utf-8", "strict")

    for _ in range(ncmds):
        if pos + 8 > commands_end:
            raise ValueError("truncated_command")
        cmd, cmdsize = struct.unpack_from("<II", data, pos)
        if cmdsize < 8 or pos + cmdsize > commands_end:
            raise ValueError("bad_command_size")
        if cmd == _LC_CODE_SIGNATURE:
            if cmdsize < 16:
                raise ValueError("bad_signature_command")
            signature = struct.unpack_from("<II", data, pos + 8)
        elif cmd in _DYLIB_LOAD_COMMANDS:
            if cmdsize < 24:
                raise ValueError("bad_dylib_command")
            (name_offset,) = struct.unpack_from("<I", data, pos + 8)
            if not 24 <= name_offset < cmdsize:
                raise ValueError("bad_dylib_name_offset")
            loads.append(_string_at(pos + name_offset, pos + cmdsize))
        elif cmd == _LC_RPATH:
            if cmdsize < 12:
                raise ValueError("bad_rpath_command")
            (path_offset,) = struct.unpack_from("<I", data, pos + 8)
            if not 12 <= path_offset < cmdsize:
                raise ValueError("bad_rpath_offset")
            rpaths.append(_string_at(pos + path_offset, pos + cmdsize))
        pos += cmdsize
    result = {"loads": loads, "rpaths": rpaths,
              "has_signature_command": signature is not None,
              "team_id": None, "signature_readable": False}
    if signature is not None:
        dataoff, datasize = signature
        team = _signature_team(data, dataoff, datasize)
        if team is not None:
            result["team_id"] = team
            result["signature_readable"] = True
    return result


def _parse_macho(data: bytes) -> dict:
    """Parse a thin or fat Mach-O into per-component signature/load facts."""
    if len(data) >= 8 and data[:4] in (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"):
        is64 = data[:4] == b"\xca\xfe\xba\xbf"
        (count,) = struct.unpack_from(">I", data, 4)
        if count < 1 or count > 16:
            raise ValueError("bad_fat_count")
        slices = []
        entry_size = 32 if is64 else 20
        for index in range(count):
            entry = 8 + index * entry_size
            if entry + entry_size > len(data):
                raise ValueError("truncated_fat")
            if is64:
                offset, size = struct.unpack_from(">QQ", data, entry + 8)
            else:
                offset, size = struct.unpack_from(">II", data, entry + 8)
            if offset + size > len(data) or size < 28:
                raise ValueError("bad_fat_slice")
            slices.append(_parse_macho_slice(data[offset:offset + size]))
    else:
        slices = [_parse_macho_slice(data)]
    teams = {s["team_id"] for s in slices if s["team_id"]}
    return {
        "loads": [name for s in slices for name in s["loads"]],
        "rpaths": [path for s in slices for path in s["rpaths"]],
        "has_signature_command": all(s["has_signature_command"] for s in slices),
        "signature_readable": all(s["signature_readable"] for s in slices),
        "team_id": next(iter(teams)) if len(teams) == 1 else None,
        "team_conflict": len(teams) > 1,
    }


def _resolve_reference(name: str, loader_dir: str, executable_dir: str,
                       rpaths: list[str], member_names: set[str]) -> bool:
    """True when a dylib load reference is satisfied by the system or bundle.

    Absolute paths are only trusted for Apple system locations; anything
    pointing at jailbreak substrate locations, other absolute paths, or a
    bundle-relative target that is not shipped stays unresolved.
    """
    lowered = name.casefold()
    if "mobilesubstrate" in lowered or "cydiasubstrate" in lowered:
        return False
    if not name or len(name) > 1024:
        return False

    def _candidate(base: str, rest: str) -> str | None:
        parts: list[str] = []
        for piece in (base + rest).split("/"):
            if piece in ("", "."):
                continue
            if piece == "..":
                if not parts:
                    return None
                parts.pop()
            else:
                parts.append(piece)
        canonical = unicodedata.normalize("NFC", "/".join(parts)).casefold()
        return canonical if canonical in member_names else None

    if name.startswith("@rpath/"):
        rest = name[len("@rpath/"):]
        for rpath in rpaths:
            if rpath.startswith("@executable_path/"):
                if _candidate(executable_dir, rpath[len("@executable_path/"):] + "/" + rest):
                    return True
            elif rpath.startswith("@loader_path/"):
                if _candidate(loader_dir, rpath[len("@loader_path/"):] + "/" + rest):
                    return True
            elif rpath == "@executable_path":
                if _candidate(executable_dir, rest):
                    return True
            elif rpath == "@loader_path":
                if _candidate(loader_dir, rest):
                    return True
            # Absolute or unknown rpaths cannot be satisfied from the bundle.
        return False
    if name.startswith("@executable_path/"):
        return _candidate(executable_dir, name[len("@executable_path/"):]) is not None
    if name.startswith("@loader_path/"):
        return _candidate(loader_dir, name[len("@loader_path/"):]) is not None
    if name.startswith("/"):
        return lowered.startswith("/system/library/") or lowered.startswith("/usr/lib/")
    # Bare install name: only resolvable when the bundle ships that basename.
    base = name.rsplit("/", 1)[-1].casefold()
    return any(path.rsplit("/", 1)[-1] == base for path in member_names)


def _nested_code_inventory(archive: zipfile.ZipFile, members: dict,
                           root: str, executable: str) -> dict:
    """Inventory nested Mach-O code and cross-check embedded metadata claims.

    Returns declarations read from the files themselves. Nothing here proves
    the signatures are valid or Apple-issued; `signatureVerified` stays a job
    for the trusted macOS verifier.
    """
    display = {name: item.filename for name, item in members.items()}
    member_names = {name for name, item in members.items() if not item.is_dir()}

    def _child_executable(directory: str) -> str | None:
        """Binary file name for a .framework/.appex/.app dir, via its plist."""
        stem = directory.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        info = members.get(directory + "/info.plist")
        if info is not None and info.file_size <= MAX_PLIST:
            try:
                parsed = _plist(_read_limited(archive, info, MAX_PLIST))
                candidate = parsed.get("CFBundleExecutable")
                if isinstance(candidate, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", candidate):
                    if (directory + "/" + candidate).casefold() in member_names:
                        return candidate
            except InspectionError:
                pass
        return stem if (directory + "/" + stem).casefold() in member_names else None

    found: dict[str, str] = {}  # canonical binary path -> kind
    main_canonical = (root + executable).casefold()
    if main_canonical in member_names:
        found[main_canonical] = "executable"
    bundle_dirs: dict[str, str] = {}
    for name in member_names:
        if not name.startswith(root) or name == main_canonical:
            continue
        if name.endswith(".dylib"):
            found.setdefault(name, "dylib")
            continue
        match = re.match(r"(.+?\.(framework|appex|app))/", name[len(root):])
        if match:
            bundle_dirs.setdefault(root + match.group(1), match.group(2))
    for directory, extension in sorted(bundle_dirs.items()):
        binary = _child_executable(directory)
        if binary is not None:
            found.setdefault((directory + "/" + binary).casefold(),
                             {"framework": "framework", "appex": "appex", "app": "app"}[extension])

    ordered = sorted(found.items())[:MAX_NESTED_COMPONENTS]
    truncated = len(found) > len(ordered)
    executable_dir = root  # canonical, trailing slash kept for prefix math

    components: list[dict] = []
    issues: set[str] = set()
    unresolved: list[dict] = []
    parsed_by_path: dict[str, dict] = {}
    for canonical, kind in ordered:
        item = members[canonical]
        record = {"path": display.get(canonical, canonical), "kind": kind,
                  "signed": False, "team_id": None}
        data = None
        if item.file_size <= MAX_MACHO_BYTES:
            try:
                data = _read_limited(archive, item, MAX_MACHO_BYTES)
            except InspectionError:
                data = None
        if data is None:
            issues.add("NESTED_CODE_UNREADABLE")
            components.append(record)
            continue
        try:
            parsed = _parse_macho(data)
        except (ValueError, struct.error, UnicodeDecodeError):
            issues.add("NESTED_CODE_UNREADABLE")
            components.append(record)
            continue
        parsed_by_path[canonical] = parsed
        record["signed"] = parsed["has_signature_command"] and parsed["signature_readable"]
        record["team_id"] = parsed["team_id"]
        if not parsed["has_signature_command"]:
            issues.add("NESTED_SIGNATURE_MISSING")
        elif not parsed["signature_readable"]:
            issues.add("NESTED_SIGNATURE_UNREADABLE")
        if parsed["team_conflict"]:
            issues.add("NESTED_TEAM_MISMATCH")
        components.append(record)

    teams = {c["team_id"] for c in components if c["team_id"]}
    if len(teams) > 1:
        issues.add("NESTED_TEAM_MISMATCH")

    for canonical, kind in ordered:
        parsed = parsed_by_path.get(canonical)
        if parsed is None:
            continue
        loader_dir = canonical.rsplit("/", 1)[0] + "/"
        seen: set[str] = set()
        for reference in parsed["loads"]:
            if reference in seen:
                continue
            seen.add(reference)
            if not _resolve_reference(reference, loader_dir, executable_dir,
                                      parsed["rpaths"], member_names):
                if len(unresolved) < MAX_UNRESOLVED_DEPS:
                    unresolved.append({"component": display.get(canonical, canonical),
                                       "reference": reference})
                issues.add("DYLIB_UNRESOLVED_DEPENDENCY")

    return {
        "components": components,
        "component_count": len(found),
        "truncated": truncated,
        "issues": [code for code in NESTED_ISSUE_CODES if code in issues],
        "unresolved_dependencies": unresolved,
        "signature_metadata_consistent": not (issues & {
            "NESTED_SIGNATURE_MISSING", "NESTED_SIGNATURE_UNREADABLE",
            "NESTED_TEAM_MISMATCH", "NESTED_CODE_UNREADABLE"}),
        "dependencies_resolved": "DYLIB_UNRESOLVED_DEPENDENCY" not in issues,
        "verification": "embedded_metadata_only_not_apple_trusted",
    }


def _profile_metadata(signed_cms: bytes) -> dict:
    """OpenSSL checks CMS message integrity, but NO issuer/chain trust.

    -noverify is deliberate for reading *untrusted* metadata only. It is NOT
    a statement that Apple signed the profile. Do not use as OTA approval.
    """
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
    profile = _plist(result.stdout)
    expires = profile.get("ExpirationDate")
    if not isinstance(expires, datetime):
        raise InspectionError("PROFILE_EXPIRY_MISSING")
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= datetime.now(timezone.utc):
        raise InspectionError("PROFILE_EXPIRED")
    team = profile.get("TeamIdentifier")
    uuids = profile.get("ProvisionedDevices")
    entitlements = profile.get("Entitlements")
    if (not isinstance(team, list) or not team or
            any(not isinstance(t, str) or not t for t in team)):
        raise InspectionError("PROFILE_TEAM_INVALID")
    if not isinstance(entitlements, dict):
        raise InspectionError("PROFILE_ENTITLEMENTS_MISSING")
    if uuids is not None and (not isinstance(uuids, list) or
                              any(not isinstance(u, str) or len(u) > 100 for u in uuids)):
        raise InspectionError("PROFILE_DEVICES_INVALID")
    return {
        "uuid": profile.get("UUID") if isinstance(profile.get("UUID"), str) else None,
        "team_id": team[0],
        "expires_at": expires.isoformat(),
        "ad_hoc_device_count": len(uuids) if uuids is not None else 0,
        "profile_type": ("enterprise" if profile.get("ProvisionsAllDevices") is True
                         else "ad_hoc" if isinstance(uuids, list)
                         else "unknown"),
        "application_identifier": entitlements.get("application-identifier"),
        "get_task_allow": entitlements.get("get-task-allow"),
        "cms_content_integrity": True,
        "apple_signer_chain_trusted": False,
    }


def inspect_ipa(filepath: Path) -> dict:
    if filepath.suffix.lower() != ".ipa" or not filepath.is_file():
        raise InspectionError("INVALID_IPA_PATH")
    archive_size = filepath.stat().st_size
    if archive_size < 100 or archive_size > MAX_IPA_BYTES:
        raise InspectionError("IPA_SIZE_LIMIT")
    sha = hashlib.sha256()
    with filepath.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            sha.update(block)
    try:
        with zipfile.ZipFile(filepath, "r", allowZip64=True) as archive:
            members = _check_members(archive)
            _verify_archive_streams(archive, members)
            apps = {
                name.split("/")[1] for name in members
                if re.match(r"^payload/[^/]+\.app/info\.plist$", name)
            }
            if len(apps) != 1:
                raise InspectionError("APP_ROOT_NOT_UNIQUE")
            root = "payload/" + next(iter(apps)) + "/"
            info_entry = members[root + "info.plist"]
            profile_entry = members.get(root + "embedded.mobileprovision")
            if profile_entry is None:
                raise InspectionError("NO_EMBEDDED_PROFILE")
            app = _plist(_read_limited(archive, info_entry, MAX_PLIST))
            bundle_id = app.get("CFBundleIdentifier")
            version = app.get("CFBundleShortVersionString")
            build = app.get("CFBundleVersion")
            executable = app.get("CFBundleExecutable")
            if (not isinstance(bundle_id, str) or
                    not re.fullmatch(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", bundle_id)):
                raise InspectionError("INVALID_BUNDLE_ID")
            if (not isinstance(executable, str) or
                    not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", executable) or
                    root + executable.casefold() not in members or
                    members[root + executable.casefold()].file_size < 1):
                raise InspectionError("INVALID_EXECUTABLE")
            if not all(isinstance(v, str) and 0 < len(v) < 80 for v in (version, build)):
                raise InspectionError("INVALID_APP_VERSION")
            profile = _profile_metadata(_read_limited(archive, profile_entry, MAX_PROFILE))
            identifier = profile["application_identifier"]
            if (not isinstance(identifier, str) or
                    not identifier.endswith("." + bundle_id)):
                raise InspectionError("PROFILE_BUNDLE_MISMATCH")
            if profile["get_task_allow"] is True:
                raise InspectionError("DEVELOPMENT_PROFILE_NOT_DISTRIBUTABLE")
            nested = _nested_code_inventory(archive, members, root, executable)
            return {
                "ipa_sha256": sha.hexdigest(),
                "ipa_size_bytes": archive_size,
                "bundle_id": bundle_id,
                "version": version,
                "build": build,
                "profile": profile,
                "nested_code": nested,
                "signature_verification": "pending_external_code_sign_check",
                "install_eligible": False,
                "status": "quarantined_not_verified",
                "notice": "Metadata only. No Apple certificate-chain or iOS code signature trust verification.",
            }
    except zipfile.BadZipFile as exc:
        raise InspectionError("INVALID_ZIP_ARCHIVE") from exc


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"status": "rejected", "error": "INVALID_USAGE"}))
        return 2
    try:
        report = inspect_ipa(Path(sys.argv[1]))
        print(json.dumps(report, ensure_ascii=False))
        return 0
    except InspectionError as exc:
        print(json.dumps({"status": "rejected", "error": exc.code}))
        return 2
    except (OSError, KeyError, ValueError, UnicodeError):
        print(json.dumps({"status": "rejected", "error": "INVALID_IPA_ARCHIVE"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
