"""Synthetic-only fixtures; never include actual IPA, P12 or mobileprovision."""
import importlib.util
import os
import plistlib
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

SOURCE = Path(__file__).parents[1] / "ipa_inspector.py"
spec = importlib.util.spec_from_file_location("ipa_inspector", SOURCE)
inspector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspector)


@unittest.skipUnless(shutil.which("openssl"), "OpenSSL binary required")
class IpaSafetyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.plist = plistlib.dumps({
            "CFBundleIdentifier": "com.example.signedapp",
            "CFBundleShortVersionString": "1.2.0",
            "CFBundleVersion": "42",
            "CFBundleExecutable": "Example"
        }, fmt=plistlib.FMT_BINARY)
        expiry = datetime.now(timezone.utc) + timedelta(days=30)
        self.profile_content = plistlib.dumps({
            "UUID": "SYNTHETIC-NOT-APPLE",
            "ExpirationDate": expiry,
            "TeamIdentifier": ["SYNTHETIC"],
            "ProvisionedDevices": ["A" * 40],
            "Entitlements": {
                "application-identifier": "SYNTHETIC.com.example.signedapp",
                "get-task-allow": False,
            }
        }, fmt=plistlib.FMT_XML)
        (self.root / "profile.plist").write_bytes(self.profile_content)
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", "key.pem", "-out", "cert.pem", "-days", "1",
            "-subj", "/CN=SYNTHETIC-TEST-NOT-APPLE"
        ], cwd=self.root, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run([
            "openssl", "cms", "-sign", "-binary", "-nodetach", "-in", "profile.plist",
            "-signer", "cert.pem", "-inkey", "key.pem", "-outform", "DER",
            "-out", "profile.cms"
        ], cwd=self.root, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def tearDown(self):
        self.tmp.cleanup()

    def make_ipa(self, changes=None):
        entries = {
            "Payload/Example.app/Info.plist": self.plist,
            "Payload/Example.app/embedded.mobileprovision": (self.root / "profile.cms").read_bytes(),
            "Payload/Example.app/Example": b"\xcf\xfa\xed\xfe" + b"x" * 100,
        }
        if changes:
            entries.update(changes)
        path = self.root / "test.ipa"
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for key, value in entries.items():
                archive.writestr(key, value)
        return path

    def test_signed_profile_is_parsed_but_never_install_approved(self):
        result = inspector.inspect_ipa(self.make_ipa())
        self.assertEqual(result["bundle_id"], "com.example.signedapp")
        self.assertEqual(result["version"], "1.2.0")
        self.assertEqual(result["profile"]["ad_hoc_device_count"], 1)
        self.assertFalse(result["profile"]["apple_signer_chain_trusted"])
        self.assertFalse(result["install_eligible"])
        self.assertNotIn("A" * 40, str(result))

    def test_rejects_traversal(self):
        with self.assertRaisesRegex(inspector.InspectionError, "UNSAFE_ARCHIVE_PATH"):
            inspector.inspect_ipa(self.make_ipa({"Payload/../password": b"test"}))

    def test_rejects_duplicate_case_insensitive_entries(self):
        with self.assertRaisesRegex(inspector.InspectionError, "DUPLICATE_ARCHIVE_PATH"):
            inspector.inspect_ipa(self.make_ipa({"Payload/Example.app/info.plist": self.plist}))

    def test_rejects_missing_app_executable(self):
        with self.assertRaisesRegex(inspector.InspectionError, "INVALID_EXECUTABLE"):
            inspector.inspect_ipa(self.make_ipa({"Payload/Example.app/Example": b""}))

    def test_rejects_unsigned_or_tampered_profile(self):
        with self.assertRaisesRegex(inspector.InspectionError, "PROFILE_CMS_INTEGRITY_FAILED"):
            inspector.inspect_ipa(self.make_ipa({
                "Payload/Example.app/embedded.mobileprovision": b"not a signed CMS" * 10
            }))

    def test_rejects_zip_bombs(self):
        with self.assertRaisesRegex(inspector.InspectionError, "ZIP_COMPRESSION_RATIO"):
            inspector.inspect_ipa(self.make_ipa({"Payload/Example.app/zeros.bin": b"\x00" * (3 * 1024 * 1024)}))


if __name__ == "__main__":
    unittest.main()
