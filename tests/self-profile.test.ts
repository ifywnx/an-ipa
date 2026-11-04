import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomToken } from "../src/modules/enrollment/secure";
import {
  buildProfileServiceMobileconfig,
  extractDeviceReportedAttributes,
  parseDeviceReportedAttributes,
  parseSelfProfileConfig,
  signMobileconfig,
  uuidFromSeed
} from "../src/modules/enrollment/self-profile";

const udid = "00008110-001234567890001E";
const challenge = randomToken();
const keyB64 = Buffer.alloc(32, 7).toString("base64");

function validEnv(patch: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    ENROLLMENT_ENABLED: "true",
    ENROLLMENT_WAF_READY: "true",
    ENROLLMENT_SELF_PROFILE_ENABLED: "true",
    APP_ORIGIN: "https://store.example.test",
    NEXT_PUBLIC_SUPABASE_URL: "https://db.example.test",
    SUPABASE_SECRET_KEY: "sb_secret_test_only",
    ENROLLMENT_UDID_ENCRYPTION_KEY_B64: keyB64,
    ENROLLMENT_TRUSTED_IP_HEADER: "x-real-ip",
    ...patch
  };
}

function devicePlist(patch: { udid?: string; token?: string; extra?: string } = {}) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
    + '<plist version="1.0"><dict>'
    + `<key>UDID</key><string>${patch.udid ?? udid}</string>`
    + "<key>PRODUCT</key><string>iPhone16,2</string>"
    + "<key>VERSION</key><string>26.0</string>"
    + "<key>SERIAL</key><string>TESTSERIAL01</string>"
    + `<key>CHALLENGE</key><string>${patch.token ?? challenge}</string>`
    + (patch.extra ?? "")
    + "</dict></plist>";
}

test("self-profile config stays off unless every gate and secret is present", () => {
  assert.equal(parseSelfProfileConfig(validEnv({ ENROLLMENT_SELF_PROFILE_ENABLED: "false" })), null);
  assert.equal(parseSelfProfileConfig(validEnv({ ENROLLMENT_SELF_PROFILE_ENABLED: undefined })), null);
  assert.equal(parseSelfProfileConfig(validEnv({ ENROLLMENT_ENABLED: "false" })), null);
  assert.equal(parseSelfProfileConfig(validEnv({ ENROLLMENT_WAF_READY: "false" })), null);
  assert.equal(parseSelfProfileConfig(validEnv({ SUPABASE_SECRET_KEY: undefined })), null);
  assert.equal(parseSelfProfileConfig(validEnv({ ENROLLMENT_UDID_ENCRYPTION_KEY_B64: undefined })), null);
  assert.equal(parseSelfProfileConfig(validEnv({ APP_ORIGIN: "http://store.example.test" })), null);
  assert.equal(parseSelfProfileConfig(validEnv({ APP_ORIGIN: "https://store.example.test/path" })), null);
  // Half-configured signing is a misconfiguration, never a silent unsigned fallback.
  assert.equal(parseSelfProfileConfig(validEnv({ ENROLLMENT_PROFILE_SIGN_CERT_PATH: "/run/secrets/cert.pem" })), null);
  assert.equal(parseSelfProfileConfig(validEnv({ ENROLLMENT_PROFILE_SIGN_KEY_PATH: "/run/secrets/key.pem" })), null);
  const unsigned = parseSelfProfileConfig(validEnv());
  assert.ok(unsigned);
  assert.equal(unsigned.signCertPath, null);
  assert.equal(unsigned.appOrigin, "https://store.example.test");
  const signing = parseSelfProfileConfig(validEnv({
    ENROLLMENT_PROFILE_SIGN_CERT_PATH: "/run/secrets/cert.pem",
    ENROLLMENT_PROFILE_SIGN_KEY_PATH: "/run/secrets/key.pem"
  }));
  assert.equal(signing?.signCertPath, "/run/secrets/cert.pem");
  assert.equal(signing?.signKeyPath, "/run/secrets/key.pem");
});

test("generated mobileconfig is a Profile Service payload bound to our callback and challenge", () => {
  const xml = buildProfileServiceMobileconfig({ appOrigin: "https://store.example.test", challenge });
  assert.match(xml, /<key>PayloadType<\/key>\s*<string>Profile Service<\/string>/);
  assert.match(xml, /<key>PayloadType<\/key>\s*<string>Configuration<\/string>/);
  assert.ok(xml.includes("<string>https://store.example.test/api/enrollment/profile-callback</string>"));
  assert.ok(xml.includes(`<key>Challenge</key>\n\t\t<string>${challenge}</string>`));
  for (const attr of ["UDID", "PRODUCT", "VERSION", "SERIAL"])
    assert.ok(xml.includes(`<string>${attr}</string>`), attr);
  const uuids = [...xml.matchAll(/<key>PayloadUUID<\/key>\s*<string>([0-9A-F-]{36})<\/string>/g)].map(m => m[1]);
  assert.equal(uuids.length, 2);
  assert.notEqual(uuids[0], uuids[1]);
  // Deterministic per session: the same challenge rebuilds the identical profile.
  assert.equal(buildProfileServiceMobileconfig({ appOrigin: "https://store.example.test", challenge }), xml);
  assert.equal(uuidFromSeed("a"), uuidFromSeed("a"));
  assert.notEqual(uuidFromSeed("a"), uuidFromSeed("b"));
  assert.throws(() => buildProfileServiceMobileconfig({ appOrigin: "https://store.example.test", challenge: "short" }));
});

test("device-reported parser accepts real-world attributes including comma PRODUCT values", () => {
  const parsed = parseDeviceReportedAttributes(devicePlist());
  assert.equal(parsed.udid, udid);
  assert.equal(parsed.challenge, challenge);
  assert.equal(parsed.product, "iPhone16,2");
  assert.equal(parsed.version, "26.0");
  assert.equal(parsed.serial, "TESTSERIAL01");
});

test("device-reported parser rejects garbage UDID, bad challenge, duplicates and markup tricks", () => {
  assert.throws(() => parseDeviceReportedAttributes(devicePlist({ udid: "not-a-udid" })), /UDID/);
  assert.throws(() => parseDeviceReportedAttributes(devicePlist({ udid: "XYZ" })), /UDID/);
  assert.throws(() => parseDeviceReportedAttributes(devicePlist({ token: "short" })), /challenge/);
  assert.throws(() => parseDeviceReportedAttributes(devicePlist({ extra: `<key>UDID</key><string>${udid}</string>` })), /Duplicate/);
  assert.throws(() => parseDeviceReportedAttributes(devicePlist().replace("<plist", "<!ENTITY x SYSTEM 'file:///etc/passwd'><plist")));
  assert.throws(() => parseDeviceReportedAttributes(devicePlist().replace(`<string>${udid}</string>`, "<string></string>")), /UDID/);
  assert.throws(() => parseDeviceReportedAttributes("<html>not a plist</html>"));
});

test("extraction accepts a plain XML body and rejects junk bodies", async () => {
  const parsed = await extractDeviceReportedAttributes(Buffer.from(devicePlist(), "utf8"));
  assert.equal(parsed.udid, udid);
  await assert.rejects(extractDeviceReportedAttributes(Buffer.from("definitely not a device response", "utf8")));
  await assert.rejects(extractDeviceReportedAttributes(Buffer.alloc(0)));
  await assert.rejects(extractDeviceReportedAttributes(Buffer.alloc(200 * 1024, 1)));
});

test("extraction opens a DER CMS envelope with -noverify semantics and returns its attributes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "an-ipa-self-profile-test-"));
  const cmd = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe", timeout: 10000 });
  try {
    // Synthetic, disposable signer — NOT an Apple device identity.
    cmd("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "signer.key", "-out", "signer.pem",
      "-days", "1", "-subj", "/CN=SYNTHETIC-SELF-PROFILE-TEST");
    writeFileSync(join(dir, "device.xml"), devicePlist());
    cmd("cms", "-sign", "-binary", "-nodetach", "-in", "device.xml", "-signer", "signer.pem",
      "-inkey", "signer.key", "-outform", "DER", "-out", "device.cms");
    const parsed = await extractDeviceReportedAttributes(readFileSync(join(dir, "device.cms")));
    assert.equal(parsed.udid, udid);
    assert.equal(parsed.challenge, challenge);
    const damaged = Buffer.from(readFileSync(join(dir, "device.cms")));
    damaged[damaged.length - 30] ^= 0x01;
    await assert.rejects(extractDeviceReportedAttributes(damaged));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("optional profile signing produces a CMS blob whose content verifies back to the exact profile", async () => {
  const dir = mkdtempSync(join(tmpdir(), "an-ipa-profile-sign-test-"));
  const cmd = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe", timeout: 10000 });
  try {
    // Synthetic self-signed cert generated in a temp dir; never committed.
    cmd("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "key.pem", "-out", "cert.pem",
      "-days", "1", "-subj", "/CN=store.example.test");
    const xml = buildProfileServiceMobileconfig({ appOrigin: "https://store.example.test", challenge });
    const signed = await signMobileconfig(Buffer.from(xml, "utf8"), join(dir, "cert.pem"), join(dir, "key.pem"));
    assert.ok(signed.length > xml.length);
    // DER signed data starts with a CMS ContentInfo SEQUENCE, not the plist.
    assert.equal(signed[0], 0x30);
    assert.ok(!signed.toString("latin1").startsWith("<?xml"));
    writeFileSync(join(dir, "signed.mobileconfig"), signed);
    cmd("smime", "-verify", "-noverify", "-inform", "DER", "-in", "signed.mobileconfig", "-out", "roundtrip.plist");
    assert.equal(readFileSync(join(dir, "roundtrip.plist"), "utf8"), xml);
    await assert.rejects(signMobileconfig(Buffer.from(xml, "utf8"), join(dir, "missing.pem"), join(dir, "key.pem")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
