"""Network-free tests for R2 SigV4 GET, safe report, claim and metadata scanner."""
import hashlib
import io
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import quarantine_worker as worker


class WorkerSafetyTests(unittest.TestCase):
    def setUp(self):
        self.cfg = {"account": "a" * 32, "bucket": "an-ipa-quarantine",
                    "access": "SYNTHETIC", "r2secret": "SYNTHETIC_SECRET"}
        self.id = "00000000-0000-4000-8000-000000000001"
        self.claim = {"id": self.id, "scan_token": "00000000-0000-4000-8000-000000000002",
                      "object_key": "quarantine/" + self.id + ".ipa",
                      "expected_bytes": 123, "scan_attempts": 1}

    def test_r2_s3_get_is_scoped_and_never_exposes_secret(self):
        url, headers = worker.r2_signed_get(self.cfg, self.claim["object_key"],
                       datetime(2026, 11, 3, tzinfo=timezone.utc))
        self.assertTrue(url.startswith("https://" + "a" * 32 + ".r2.cloudflarestorage.com/"))
        self.assertTrue(url.endswith("/an-ipa-quarantine/quarantine/" + self.id + ".ipa"))
        self.assertIn("SignedHeaders=host;x-amz-content-sha256;x-amz-date", headers["Authorization"])
        self.assertNotIn(self.cfg["r2secret"], str(headers))
        self.assertRaises(worker.WorkerError, worker.r2_signed_get,
                          self.cfg, "diagnostics/a.txt")
        self.assertRaises(worker.WorkerError, worker.r2_signed_get,
                          self.cfg, "quarantine/../../secrets.ipa")

    def test_claim_can_only_read_own_generated_uuid_object(self):
        self.assertEqual(worker.validate_claim([self.claim]), self.claim)
        self.assertRaises(worker.WorkerError, worker.validate_claim,
                          [{**self.claim, "object_key": "quarantine/other.ipa"}])
        self.assertRaises(worker.WorkerError, worker.validate_claim,
                          [{**self.claim, "scan_attempts": 4}])

    def test_report_never_persists_udids_or_install_grants(self):
        report = worker.sanitized_report({
            "bundle_id": "com.example.demo", "version": "1.0", "build": "1",
            "profile": {"profile_type": "ad_hoc", "team_id": "SYNTHETIC",
                        "expires_at": "2027-01-01T00:00:00+00:00",
                        "ad_hoc_device_count": 1,
                        "ProvisionedDevices": ["SECRET-UDID"],
                        "cms_content_integrity": True}})
        self.assertNotIn("SECRET-UDID", str(report))
        self.assertFalse(report["install_eligible"])
        self.assertFalse(report["apple_signer_chain_trusted"])
        self.assertFalse(report["code_signature_verified"])

    def test_get_streaming_limits_size_and_checks_hash(self):
        body = b"PK\x03\x04" + b"A" * 119
        class Response(io.BytesIO):
            headers = {"Content-Length": str(len(body))}
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(worker, "secure_opener") as opener:
                opener.return_value.open.return_value = Response(body)
                path = Path(tmp)/"test.ipa"
                sha = worker.download_to_quarantine(self.cfg, self.claim, path)
                self.assertEqual(sha, hashlib.sha256(body).hexdigest())
                self.assertEqual(path.read_bytes(), body)
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(worker, "secure_opener") as opener:
                opener.return_value.open.return_value = Response(body + b"B")
                with self.assertRaisesRegex(worker.WorkerError, "OBJECT_TOO_LARGE"):
                    worker.download_to_quarantine(self.cfg, self.claim, Path(tmp)/"test.ipa")

    def test_worker_never_approves_ota_even_on_valid_metadata(self):
        fake_report = {"ipa_sha256": "a"*64, "ipa_size_bytes": 123,
                       "bundle_id": "com.example.demo", "version": "1.0", "build": "1",
                       "profile": {"profile_type":"ad_hoc","team_id":"SYNTHETIC",
                                   "expires_at":"2027-01-01T00:00:00+00:00",
                                   "ad_hoc_device_count":0,"cms_content_integrity":True}}
        with mock.patch.object(worker, "rpc", side_effect=[
            {"expired_intakes":0}, [self.claim], True]) as rpc, mock.patch.object(
                worker, "download_to_quarantine", return_value="a"*64), mock.patch.object(
                    worker, "inspect_ipa", return_value=fake_report):
            result = worker.run_one(self.cfg)
        self.assertEqual(result["status"], "quarantined_unverified")
        final_payload=rpc.call_args_list[-1].args[2]
        self.assertEqual(final_payload["p_state"], "quarantined_unverified")
        self.assertNotIn("install_eligible", final_payload)
        self.assertFalse(final_payload["p_report"]["install_eligible"])

    def test_worker_does_not_run_without_enable_flag(self):
        with mock.patch.dict("os.environ", {"IPA_QUARANTINE_WORKER_ENABLED":"false"}):
            self.assertEqual(worker.main(), 0)


if __name__ == "__main__":
    unittest.main()
