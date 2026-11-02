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
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

MAX_IPA_BYTES = 500 * 1024 * 1024
MAX_MEMBERS = 20_000
MAX_TOTAL_UNCOMPRESSED = 2 * 1024 * 1024 * 1024
MAX_RATIO = 300
MAX_PLIST = 1024 * 1024
MAX_PROFILE = 1024 * 1024


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
                or any(ord(char) < 32 for char in name)
                or len(name) > 1024):
            raise InspectionError("UNSAFE_ARCHIVE_PATH")
        canonical = name.rstrip("/").casefold()
        if canonical in names:
            raise InspectionError("DUPLICATE_ARCHIVE_PATH")
        mode = stat.S_IFMT(item.external_attr >> 16)
        if mode not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise InspectionError("UNSAFE_ARCHIVE_FILE_TYPE")
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
            return {
                "ipa_sha256": sha.hexdigest(),
                "ipa_size_bytes": archive_size,
                "bundle_id": bundle_id,
                "version": version,
                "build": build,
                "profile": profile,
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
