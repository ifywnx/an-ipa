"""Synthetic Mach-O fixtures for the nested-code (dylib) inventory.

Every IPA on this store is dylib-injected, so the inspector must inventory
nested code, compare embedded Team ID *claims* and flag load references that
cannot resolve on a non-jailbroken device. Fixtures are fabricated locally;
no real IPA, dylib, certificate or profile is used. The signature blobs are
structurally valid containers with empty hashes: they exercise metadata
parsing only and prove nothing about Apple trust.
"""
import importlib.util
import plistlib
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

WORKERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKERS))
spec = importlib.util.spec_from_file_location("ipa_inspector", WORKERS / "ipa_inspector.py")
inspector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspector)
import quarantine_worker as worker


def _pad8(blob: bytes) -> bytes:
    return blob + b"\x00" * (-len(blob) % 8)


def _with_cmdsize(padded: bytes) -> bytes:
    """Rewrite the cmdsize field (bytes 4..8) to include alignment padding."""
    return padded[:4] + struct.pack("<I", len(padded)) + padded[8:]


def _dylib_command(name: str, cmd: int = 0x0C) -> bytes:
    encoded = name.encode() + b"\x00"
    body = struct.pack("<IIIIII", cmd, 0, 24, 2, 0, 0) + encoded
    return _with_cmdsize(_pad8(body))


def _rpath_command(path: str) -> bytes:
    encoded = path.encode() + b"\x00"
    body = struct.pack("<III", 0x1C00001C, 0, 12) + encoded
    return _with_cmdsize(_pad8(body))


def _code_directory(team: str) -> bytes:
    ident = b"com.example.synthetic\x00"
    team_bytes = team.encode() + b"\x00"
    header_size = 52
    length = header_size + len(ident) + len(team_bytes)
    header = struct.pack(
        ">IIIIIIIII", 0xFADE0C02, length, 0x20100, 0,
        length, header_size, 0, 0, 0)
    header += struct.pack(">BBBBIII", 0, 0, 0, 0, 0, 0,
                          header_size + len(ident))
    return header + ident + team_bytes


def _superblob(team: str) -> bytes:
    directory = _code_directory(team)
    return struct.pack(">IIIII", 0xFADE0CC0, 20 + len(directory), 1, 0, 20) + directory


def build_macho(loads=(), rpaths=(), team="TEAMAAA111", signed=True, filetype=2):
    commands = b"".join(_dylib_command(name) for name in loads)
    commands += b"".join(_rpath_command(path) for path in rpaths)
    blob = _superblob(team) if signed else b""
    sizeofcmds = len(commands) + (16 if signed else 0)
    if signed:
        dataoff = 32 + sizeofcmds
        commands += struct.pack("<IIII", 0x1D, 16, dataoff, len(blob))
    ncmds = len(loads) + len(rpaths) + (1 if signed else 0)
    header = struct.pack("<IiiIIIII", 0xFEEDFACF, 0x0100000C, 0,
                         filetype, ncmds, sizeofcmds, 0, 0)
    return header + commands + blob


TEAM = "TEAMAAA111"
EXE_LOADS = ["@rpath/Tweak.dylib", "@rpath/Demo.framework/Demo",
             "/usr/lib/libSystem.B.dylib"]


@unittest.skipUnless(shutil.which("openssl"), "OpenSSL binary required")
class NestedCodeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.plist = plistlib.dumps({
            "CFBundleIdentifier": "com.example.signedapp",
            "CFBundleShortVersionString": "1.2.0",
            "CFBundleVersion": "42",
            "CFBundleExecutable": "Example",
        }, fmt=plistlib.FMT_BINARY)
        expiry = datetime.now(timezone.utc) + timedelta(days=30)
        profile_content = plistlib.dumps({
            "UUID": "SYNTHETIC-NOT-APPLE",
            "ExpirationDate": expiry,
            "TeamIdentifier": [TEAM],
            "ProvisionedDevices": ["A" * 40],
            "Entitlements": {
                "application-identifier": TEAM + ".com.example.signedapp",
                "get-task-allow": False,
            },
        }, fmt=plistlib.FMT_XML)
        (self.root / "profile.plist").write_bytes(profile_content)
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", "key.pem", "-out", "cert.pem", "-days", "1",
            "-subj", "/CN=SYNTHETIC-TEST-NOT-APPLE",
        ], cwd=self.root, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run([
            "openssl", "cms", "-sign", "-binary", "-nodetach", "-in", "profile.plist",
            "-signer", "cert.pem", "-inkey", "key.pem", "-outform", "DER",
            "-out", "profile.cms",
        ], cwd=self.root, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def tearDown(self):
        self.tmp.cleanup()

    def make_ipa(self, exe=None, tweak=None, extra=None):
        framework_plist = plistlib.dumps(
            {"CFBundleExecutable": "Demo"}, fmt=plistlib.FMT_BINARY)
        appex_plist = plistlib.dumps(
            {"CFBundleExecutable": "Widget"}, fmt=plistlib.FMT_BINARY)
        entries = {
            "Payload/Example.app/Info.plist": self.plist,
            "Payload/Example.app/embedded.mobileprovision":
                (self.root / "profile.cms").read_bytes(),
            "Payload/Example.app/Example": exe if exe is not None else build_macho(
                loads=EXE_LOADS, rpaths=["@executable_path/Frameworks"]),
            "Payload/Example.app/Frameworks/Tweak.dylib":
                tweak if tweak is not None else build_macho(
                    loads=["/usr/lib/libobjc.A.dylib"], filetype=6),
            "Payload/Example.app/Frameworks/Demo.framework/Info.plist": framework_plist,
            "Payload/Example.app/Frameworks/Demo.framework/Demo": build_macho(filetype=6),
            "Payload/Example.app/PlugIns/Widget.appex/Info.plist": appex_plist,
            "Payload/Example.app/PlugIns/Widget.appex/Widget": build_macho(filetype=2),
        }
        if extra:
            entries.update(extra)
        path = self.root / "test.ipa"
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for key, value in entries.items():
                archive.writestr(key, value)
        return path

    def components_by_kind(self, report):
        return {c["kind"]: c for c in report["nested_code"]["components"]}

    def test_consistent_injected_ipa_passes_structural_checks(self):
        report = inspector.inspect_ipa(self.make_ipa())
        nested = report["nested_code"]
        self.assertEqual(nested["issues"], [])
        self.assertTrue(nested["signature_metadata_consistent"])
        self.assertTrue(nested["dependencies_resolved"])
        kinds = self.components_by_kind(report)
        self.assertEqual(set(kinds), {"executable", "dylib", "framework", "appex"})
        for component in nested["components"]:
            self.assertTrue(component["signed"], component)
            self.assertEqual(component["team_id"], TEAM)
        self.assertFalse(report["install_eligible"])

    def test_unsigned_dylib_fails_with_missing_signature_code(self):
        report = inspector.inspect_ipa(self.make_ipa(tweak=build_macho(signed=False, filetype=6)))
        self.assertIn("NESTED_SIGNATURE_MISSING", report["nested_code"]["issues"])
        self.assertFalse(self.components_by_kind(report)["dylib"]["signed"])
        self.assertFalse(report["nested_code"]["signature_metadata_consistent"])

    def test_dylib_with_other_team_fails_with_team_mismatch_code(self):
        report = inspector.inspect_ipa(
            self.make_ipa(tweak=build_macho(team="TEAMBBB222", filetype=6)))
        self.assertIn("NESTED_TEAM_MISMATCH", report["nested_code"]["issues"])
        self.assertEqual(self.components_by_kind(report)["dylib"]["team_id"], "TEAMBBB222")

    def test_substrate_reference_without_bundled_library_is_flagged(self):
        exe = build_macho(loads=["/Library/MobileSubstrate/DynamicLibraries/Tweak.dylib"])
        report = inspector.inspect_ipa(self.make_ipa(exe=exe))
        nested = report["nested_code"]
        self.assertIn("DYLIB_UNRESOLVED_DEPENDENCY", nested["issues"])
        self.assertFalse(nested["dependencies_resolved"])
        references = [u["reference"] for u in nested["unresolved_dependencies"]]
        self.assertTrue(any("MobileSubstrate" in ref for ref in references))

    def test_missing_rpath_target_is_flagged(self):
        exe = build_macho(loads=["@rpath/Missing.dylib"],
                          rpaths=["@executable_path/Frameworks"])
        report = inspector.inspect_ipa(self.make_ipa(exe=exe))
        self.assertIn("DYLIB_UNRESOLVED_DEPENDENCY", report["nested_code"]["issues"])

    def test_sanitized_report_persists_inventory_within_db_limit(self):
        report = inspector.inspect_ipa(self.make_ipa(tweak=build_macho(signed=False, filetype=6)))
        summary = worker.sanitized_report(report)
        self.assertIn("NESTED_SIGNATURE_MISSING", summary["nested_issues"])
        self.assertFalse(summary["nested_signature_consistent"])
        self.assertTrue(summary["dylib_dependencies_resolved"])
        paths = {entry["p"] for entry in summary["nested_components"]}
        self.assertTrue(any(path.endswith("Tweak.dylib") for path in paths))
        import json
        self.assertLessEqual(len(json.dumps(summary).encode()), 4096)
        self.assertFalse(summary["code_signature_verified"])
        self.assertFalse(summary["install_eligible"])


if __name__ == "__main__":
    unittest.main()
