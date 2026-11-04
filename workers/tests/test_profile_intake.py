"""Synthetic-only fixtures for the standalone profile intake worker."""
import importlib.util
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

WORKERS = Path(__file__).parents[1]
sys.path.insert(0, str(WORKERS))

spec = importlib.util.spec_from_file_location(
    "profile_intake", WORKERS / "profile_intake.py")
intake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(intake)
InspectionError = intake.InspectionError

FIXTURES = WORKERS / "macos-verifier" / "fixtures"
vspec = importlib.util.spec_from_file_location(
    "macos_verify", WORKERS / "macos-verifier" / "verify.py")
verifier = importlib.util.module_from_spec(vspec)
vspec.loader.exec_module(verifier)


@unittest.skipUnless(shutil.which("openssl"), "OpenSSL binary required")
class ProfileIntakeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", "key.pem", "-out", "cert.pem", "-days", "1",
            "-subj", "/CN=SYNTHETIC-TEST-NOT-APPLE"
        ], cwd=self.root, check=True, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL)

    def tearDown(self):
        self.tmp.cleanup()

    def sign(self, profile: dict) -> bytes:
        plist_path = self.root / "profile.plist"
        plist_path.write_bytes(plistlib.dumps(profile, fmt=plistlib.FMT_XML))
        out = self.root / "profile.mobileprovision"
        subprocess.run([
            "openssl", "cms", "-sign", "-binary", "-nodetach",
            "-in", str(plist_path), "-signer", str(self.root / "cert.pem"),
            "-inkey", str(self.root / "key.pem"), "-outform", "DER",
            "-out", str(out)
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return out.read_bytes()

    def base_profile(self, **overrides):
        profile = {
            "UUID": "SYNTHETIC-NOT-APPLE",
            "ExpirationDate": datetime.now(timezone.utc) + timedelta(days=90),
            "TeamIdentifier": ["TEAM123456"],
            "ProvisionedDevices": ["a" * 40, "00008110-001234567890001e"],
            "Entitlements": {
                "application-identifier": "TEAM123456.com.example.signedapp",
                "get-task-allow": False,
            },
        }
        profile.update(overrides)
        return profile

    def test_extracts_ad_hoc_evidence_with_canonical_udids(self):
        evidence = intake.extract_profile_evidence(self.sign(self.base_profile()))
        self.assertEqual(evidence["team_id"], "TEAM123456")
        self.assertEqual(evidence["bundle_id"], "com.example.signedapp")
        self.assertEqual(evidence["profile_type"], "ad_hoc")
        self.assertEqual(
            evidence["provisioned_udids"],
            ["A" * 40, "00008110-001234567890001E"])
        self.assertFalse(evidence["expired"])
        self.assertTrue(evidence["cms_content_integrity"])
        self.assertFalse(evidence["apple_signer_chain_trusted"])
        self.assertFalse(evidence["install_eligible"])

    def test_expired_profile_is_recorded_not_rejected(self):
        evidence = intake.extract_profile_evidence(self.sign(self.base_profile(
            ExpirationDate=datetime.now(timezone.utc) - timedelta(days=1))))
        self.assertTrue(evidence["expired"])
        self.assertIn("expires_at", evidence)

    def test_wildcard_profile_has_no_concrete_bundle(self):
        evidence = intake.extract_profile_evidence(self.sign(self.base_profile(
            Entitlements={
                "application-identifier": "TEAM123456.*",
                "get-task-allow": False,
            })))
        self.assertIsNone(evidence["bundle_id"])
        self.assertTrue(evidence["bundle_wildcard"])

    def test_development_profile_type_detected(self):
        evidence = intake.extract_profile_evidence(self.sign(self.base_profile(
            Entitlements={
                "application-identifier": "TEAM123456.com.example.signedapp",
                "get-task-allow": True,
            })))
        self.assertEqual(evidence["profile_type"], "development")

    def test_rejects_tampered_cms(self):
        with self.assertRaisesRegex(InspectionError, "PROFILE_CMS_INTEGRITY_FAILED"):
            intake.extract_profile_evidence(b"not a signed CMS" * 10)

    def test_rejects_raw_unsigned_plist(self):
        raw = plistlib.dumps(self.base_profile(), fmt=plistlib.FMT_XML)
        with self.assertRaisesRegex(InspectionError, "PROFILE_CMS_INTEGRITY_FAILED"):
            intake.extract_profile_evidence(raw)

    def test_rejects_missing_team(self):
        profile = self.base_profile()
        del profile["TeamIdentifier"]
        with self.assertRaisesRegex(InspectionError, "PROFILE_TEAM_INVALID"):
            intake.extract_profile_evidence(self.sign(profile))

    def test_rejects_invalid_udid_entry(self):
        with self.assertRaisesRegex(InspectionError, "PROFILE_DEVICES_INVALID"):
            intake.extract_profile_evidence(self.sign(self.base_profile(
                ProvisionedDevices=["not-a-udid"])))


class MacosVerifierParserTests(unittest.TestCase):
    def test_parse_codesign_info_signed(self):
        info = verifier.parse_codesign_info(
            (FIXTURES / "codesign-info-main.txt").read_text())
        self.assertEqual(info["identifier"], "com.example.synthetic")
        self.assertEqual(info["team_id"], "TEAM123456")
        self.assertTrue(info["signed"])
        self.assertEqual(len(info["authorities"]), 3)

    def test_parse_codesign_info_linker_signed_has_no_team(self):
        info = verifier.parse_codesign_info(
            (FIXTURES / "codesign-info-unsigned.txt").read_text())
        self.assertIsNone(info["team_id"])
        self.assertFalse(info["signed"])

    def test_parse_codesign_verify_output(self):
        text = (FIXTURES / "codesign-verify-ok.txt").read_text()
        self.assertTrue(verifier.parse_codesign_verify_ok(0, text))
        self.assertFalse(verifier.parse_codesign_verify_ok(1, text))
        self.assertFalse(verifier.parse_codesign_verify_ok(
            0, "app: code object is not signed at all"))

    def test_parse_openssl_enddate(self):
        parsed = verifier.parse_openssl_enddate(
            (FIXTURES / "openssl-enddate.txt").read_text())
        self.assertEqual(parsed, "2027-02-14T09:30:00+00:00")
        self.assertIsNone(verifier.parse_openssl_enddate("garbage"))

    def test_parse_verify_cert_revoked(self):
        text = (FIXTURES / "verify-cert-revoked.txt").read_text()
        verdict = verifier.parse_verify_cert(1, text)
        self.assertTrue(verdict["revoked"])
        self.assertFalse(verdict["chain_valid"])
        self.assertEqual(verifier.parse_verify_cert(0, "")["revocation_check"], "ok")

    def test_entitlements_match_rules(self):
        profile = {"Entitlements": {
            "application-identifier": "TEAM123456.com.example.synthetic",
            "keychain-access-groups": ["TEAM123456.com.example.synthetic"],
        }}
        good = {"application-identifier": "TEAM123456.com.example.synthetic",
                "keychain-access-groups": ["TEAM123456.com.example.synthetic"]}
        self.assertTrue(verifier.entitlements_match(good, profile, "com.example.synthetic"))
        debug = dict(good, **{"get-task-allow": True})
        self.assertFalse(verifier.entitlements_match(debug, profile, "com.example.synthetic"))
        extra = dict(good, **{"com.apple.security.application-groups": ["group.x"]})
        self.assertFalse(verifier.entitlements_match(extra, profile, "com.example.synthetic"))

    @unittest.skipIf(sys.platform == "darwin", "gate only applies off macOS")
    def test_refuses_to_run_without_macos(self):
        with self.assertRaisesRegex(verifier.VerifyError, "MACOS_REQUIRED"):
            verifier.verify_artifact(Path("anything.ipa"))


if __name__ == "__main__":
    unittest.main()
