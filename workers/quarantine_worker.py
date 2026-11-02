#!/usr/bin/env python3
"""One-shot, server-only R2 IPA quarantine inspector.

Run on an isolated network-restricted container with CPU/RAM/disk limits.
This does not verify Apple code signatures and NEVER authorizes OTA.
The owner signs with LCSign on iPhone; no P12/private key is handled here.
"""
from __future__ import annotations
import hashlib
import hmac
import io
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from ipa_inspector import InspectionError, inspect_ipa

MAX_BYTES = 100 * 1024 * 1024
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
S3_EMPTY_SHA = hashlib.sha256(b"").hexdigest()
SAFE_ERROR = re.compile(r"^[A-Z0-9_]{3,60}$")


class WorkerError(Exception):
    def __init__(self, code: str, transient: bool = False):
        super().__init__(code)
        self.code = code
        self.transient = transient


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def secure_opener():
    return urllib.request.build_opener(NoRedirect)


def required_env(name: str) -> str:
    val = os.environ.get(name, "")
    if not val or len(val) > 300:
        raise WorkerError("INVALID_WORKER_CONFIG")
    return val


def validate_config() -> dict[str, str]:
    supabase = required_env("SUPABASE_URL")
    parsed = urllib.parse.urlsplit(supabase)
    if (parsed.scheme != "https" or not parsed.hostname
            or not re.fullmatch(r"[a-z0-9-]+\.supabase\.co", parsed.hostname)
            or parsed.username or parsed.password or parsed.port
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
        raise WorkerError("INVALID_SUPABASE_ORIGIN")
    cfg = {"supabase": "https://" + parsed.hostname,
           "secret": required_env("SUPABASE_SECRET_KEY"),
           "account": required_env("R2_ACCOUNT_ID"),
           "bucket": required_env("R2_BUCKET"),
           "access": required_env("R2_ACCESS_KEY_ID"),
           "r2secret": required_env("R2_SECRET_ACCESS_KEY")}
    if not re.fullmatch("[0-9a-fA-F]{32}", cfg["account"]):
        raise WorkerError("INVALID_R2_ACCOUNT")
    if not re.fullmatch("[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", cfg["bucket"]):
        raise WorkerError("INVALID_R2_BUCKET")
    return cfg


def _sha(blob: bytes | str) -> str:
    return hashlib.sha256(blob.encode() if isinstance(blob, str) else blob).hexdigest()


def _hmac(key: bytes | str, data: str) -> bytes:
    return hmac.new(key.encode() if isinstance(key, str) else key,
                    data.encode(), hashlib.sha256).digest()


def r2_signed_get(cfg: dict[str, str], object_key: str, now: datetime | None = None):
    if not re.fullmatch(r"quarantine/[0-9a-f-]{36}\.ipa", object_key):
        raise WorkerError("INVALID_QUARANTINE_KEY")
    receipt_id = object_key[len("quarantine/"):-len(".ipa")]
    if not UUID.fullmatch(receipt_id):
        raise WorkerError("INVALID_QUARANTINE_KEY")
    now = now or datetime.now(timezone.utc)
    stamp = now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    day, host = stamp[:8], cfg["account"].lower() + ".r2.cloudflarestorage.com"
    scope = day + "/auto/s3/aws4_request"
    path = "/" + urllib.parse.quote(cfg["bucket"], safe="") + "/" + urllib.parse.quote(object_key, safe="/")
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_headers = (f"host:{host}\nx-amz-content-sha256:{S3_EMPTY_SHA}\n"
                         f"x-amz-date:{stamp}\n")
    canonical = "\n".join(["GET", path, "", canonical_headers, signed_headers, S3_EMPTY_SHA])
    to_sign = "\n".join(["AWS4-HMAC-SHA256", stamp, scope, _sha(canonical)])
    signing_key = _hmac(_hmac(_hmac(_hmac("AWS4" + cfg["r2secret"], day), "auto"), "s3"),
                        "aws4_request")
    signature = hmac.new(signing_key, to_sign.encode(), hashlib.sha256).hexdigest()
    authorization = (f"AWS4-HMAC-SHA256 Credential={cfg['access']}/{scope}, "
                     f"SignedHeaders={signed_headers}, Signature={signature}")
    url = "https://" + host + path
    headers = {"Authorization": authorization, "x-amz-date": stamp,
               "x-amz-content-sha256": S3_EMPTY_SHA}
    return url, headers


def rpc(cfg: dict[str, str], endpoint: str, payload: dict) -> object:
    if endpoint not in ("reap_expired_ipa_scans", "claim_ipa_scan", "finish_ipa_scan"):
        raise WorkerError("INVALID_RPC")
    url = cfg["supabase"] + "/rest/v1/rpc/" + endpoint
    headers = {"apikey": cfg["secret"], "Content-Type": "application/json",
               "Accept": "application/json", "User-Agent": "AN-IPA-Quarantine-Worker/1"}
    # New sb_secret_* keys are API keys, NOT JWTs; never send as bearer.
    if not cfg["secret"].startswith("sb_secret_"):
        headers["Authorization"] = "Bearer " + cfg["secret"]
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers=headers, method="POST")
    try:
        with secure_opener().open(req, timeout=10) as response:
            data = response.read(32769)
            if len(data) > 32768:
                raise WorkerError("RPC_RESPONSE_TOO_LARGE", True)
            return json.loads(data)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as exc:
        # Never log URLs or headers (R2/Supabase credentials may be sensitive).
        raise WorkerError("SUPABASE_RPC_UNAVAILABLE", True) from exc


def validate_claim(data: object) -> dict:
    if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
        raise WorkerError("INVALID_SCAN_CLAIM")
    item = data[0]
    receipt_id = item.get("id")
    token = item.get("scan_token")
    expected = item.get("expected_bytes")
    attempts = item.get("scan_attempts")
    if not isinstance(receipt_id, str) or not UUID.fullmatch(receipt_id):
        raise WorkerError("INVALID_SCAN_CLAIM")
    if not isinstance(token, str) or not UUID.fullmatch(token):
        raise WorkerError("INVALID_SCAN_CLAIM")
    if item.get("object_key") != "quarantine/" + receipt_id + ".ipa":
        raise WorkerError("INVALID_SCAN_CLAIM")
    if (not isinstance(expected, int) or isinstance(expected, bool) or
            not 100 <= expected <= MAX_BYTES or
            type(attempts) is not int or not 1 <= attempts <= 3):
        raise WorkerError("INVALID_SCAN_CLAIM")
    return item


def download_to_quarantine(cfg: dict[str, str], claim: dict, destination: Path) -> str:
    url, headers = r2_signed_get(cfg, claim["object_key"])
    req = urllib.request.Request(url, headers=headers, method="GET")
    digest = hashlib.sha256()
    total = 0
    try:
        with secure_opener().open(req, timeout=45) as source:
            advertised = source.headers.get("Content-Length")
            if advertised and (not advertised.isdigit() or
                               int(advertised) != claim["expected_bytes"]):
                raise WorkerError("OBJECT_LENGTH_MISMATCH")
            # TemporaryDirectory private path; no archive extraction.
            with destination.open("xb") as output:
                while True:
                    part = source.read(1024 * 1024)
                    if not part:
                        break
                    total += len(part)
                    if total > claim["expected_bytes"] or total > MAX_BYTES:
                        raise WorkerError("OBJECT_TOO_LARGE")
                    digest.update(part)
                    output.write(part)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise WorkerError("R2_OBJECT_NOT_FOUND", True) from exc
        if exc.code in (401, 403):
            raise WorkerError("R2_ACCESS_DENIED", True) from exc
        raise WorkerError("R2_DOWNLOAD_ERROR", True) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise WorkerError("R2_DOWNLOAD_ERROR", True) from exc
    if total != claim["expected_bytes"]:
        raise WorkerError("OBJECT_LENGTH_MISMATCH")
    return digest.hexdigest()


def sanitized_report(inspected: dict) -> dict:
    """Whitelist tiny, non-sensitive metadata; never store UDID, CMS or certs."""
    p = inspected.get("profile", {})
    result = {
        "bundle_id": inspected.get("bundle_id"),
        "version": inspected.get("version"),
        "build": inspected.get("build"),
        "profile_type": p.get("profile_type"),
        "team_id": p.get("team_id"),
        "profile_expires_at": p.get("expires_at"),
        "ad_hoc_device_count": p.get("ad_hoc_device_count"),
        "cms_content_integrity": p.get("cms_content_integrity") is True,
        "apple_signer_chain_trusted": False,
        "code_signature_verified": False,
        "install_eligible": False,
    }
    for name in ("bundle_id", "version", "build", "profile_type",
                 "team_id", "profile_expires_at"):
        if not isinstance(result[name], str) or len(result[name]) > 128:
            raise WorkerError("UNSAFE_REPORT_METADATA")
    if (type(result["ad_hoc_device_count"]) is not int or
            not 0 <= result["ad_hoc_device_count"] <= 100000):
        raise WorkerError("UNSAFE_REPORT_METADATA")
    if len(json.dumps(result, ensure_ascii=True).encode()) > 4096:
        raise WorkerError("UNSAFE_REPORT_METADATA")
    return result


def run_one(cfg: dict[str, str]) -> dict:
    rpc(cfg, "reap_expired_ipa_scans", {})
    data = rpc(cfg, "claim_ipa_scan", {})
    if data == []:
        return {"status": "idle"}
    claim = validate_claim(data)
    state, sha, report, error = "rejected", None, None, None
    try:
        with tempfile.TemporaryDirectory(prefix="an-ipa-") as tmp:
            filepath = Path(tmp) / "quarantined.ipa"
            sha = download_to_quarantine(cfg, claim, filepath)
            inspected = inspect_ipa(filepath)
            if inspected.get("ipa_sha256") != sha or inspected.get("ipa_size_bytes") != claim["expected_bytes"]:
                raise WorkerError("CONTENT_DIGEST_MISMATCH")
            report = sanitized_report(inspected)
            state = "quarantined_unverified"
    except InspectionError as exc:
        error = exc.code if SAFE_ERROR.fullmatch(exc.code) else "IPA_INSPECTION_REJECTED"
        sha = None
    except WorkerError as exc:
        error = exc.code
        sha = None
        if exc.transient and claim["scan_attempts"] < 3:
            state = "uploaded_pending_scan"
    except Exception:
        # Fail closed and avoid exposing filesystem paths, object keys or secrets.
        error, sha = "IPA_SCAN_FAILED", None
    payload = {
        "p_id": claim["id"], "p_token": claim["scan_token"],
        "p_state": state, "p_sha256": sha,
        "p_report": report, "p_error": error
    }
    complete = rpc(cfg, "finish_ipa_scan", payload)
    if complete is not True:
        raise WorkerError("SCAN_LEASE_LOST", True)
    return {"status": state, "reason": error or "METADATA_ONLY_NOT_APPLE_TRUSTED"}


def main() -> int:
    if os.environ.get("IPA_QUARANTINE_WORKER_ENABLED") != "true":
        print(json.dumps({"status": "disabled"}))
        return 0
    try:
        result = run_one(validate_config())
        print(json.dumps(result))
        return 0
    except WorkerError as exc:
        print(json.dumps({"status": "error", "code": exc.code}))
        return 1
    except Exception:
        print(json.dumps({"status": "error", "code": "WORKER_UNAVAILABLE"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
