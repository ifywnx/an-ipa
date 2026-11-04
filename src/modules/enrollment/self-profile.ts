/**
 * Pragmatic self-serve Profile Service mode ("device-reported" trust level).
 *
 * In this mode the store itself serves a Profile Service .mobileconfig and
 * receives the iPhone's response on its own callback endpoint, instead of
 * delegating to an external verified Profile Service provider.
 *
 * TRUST LEVEL — READ CAREFULLY:
 * - The CMS/PKCS#7 blob the device posts is opened with `openssl cms -verify
 *   -noverify` ONLY to extract the plist inside. The Apple device-identity
 *   certificate chain is NOT verified in this mode. Anyone can craft such a
 *   body offline, so the extracted UDID is self-asserted evidence, exactly
 *   like a manually typed UDID.
 * - Results therefore land in `pending_unverified` (manual_udid_requests,
 *   source='self_profile') and the guest session completes as
 *   'device_reported', NEVER 'verified'. This mode must never be treated as
 *   device identity verification and never satisfies OTA eligibility, which
 *   requires the provider-attested path (see docs/ENROLLMENT_PROTOCOL.md).
 * - This module is server-side only by usage (API routes). It is not marked
 *   `server-only` so unit tests can import the pure helpers, following the
 *   apple-cms.ts / secure.ts precedent in this folder.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keyFromBase64, sha256 } from "./secure";
import { normalizeUdid } from "../devices/policy";

const runFile = promisify(execFile);

export const PROFILE_CALLBACK_PATH = "/api/enrollment/profile-callback";
export const MAX_DEVICE_RESPONSE_BYTES = 128 * 1024;
const MAX_PLIST_BYTES = 16 * 1024;
const APPLE_PLIST_DOCTYPE = '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">';
const CHALLENGE_FORMAT = /^[A-Za-z0-9_-]{40,64}$/;

export interface SelfProfileConfig {
  appOrigin: string;
  supabaseUrl: string;
  serviceKey: string;
  encryptionKey: Buffer;
  trustedIpHeader: string;
  /** Both null (serve unsigned profile) or both set (sign with openssl smime). */
  signCertPath: string | null;
  signKeyPath: string | null;
}

/**
 * Self-profile mode is an ADDITIONAL gate on top of the existing enrollment
 * gates: ENROLLMENT_ENABLED + ENROLLMENT_WAF_READY + the shared enrollment
 * secrets must all be present, and ENROLLMENT_SELF_PROFILE_ENABLED must be
 * the exact string "true". Anything else returns null and every self-profile
 * endpoint answers 503, exactly like the provider mode when unconfigured.
 */
export function parseSelfProfileConfig(env: Record<string, string | undefined>): SelfProfileConfig | null {
  if (env.ENROLLMENT_ENABLED !== "true" || env.ENROLLMENT_WAF_READY !== "true"
    || env.ENROLLMENT_SELF_PROFILE_ENABLED !== "true") return null;
  const appOrigin = env.APP_ORIGIN, supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SECRET_KEY, keyB64 = env.ENROLLMENT_UDID_ENCRYPTION_KEY_B64;
  const ipHeader = env.ENROLLMENT_TRUSTED_IP_HEADER;
  if (!appOrigin || !supabaseUrl || !serviceKey || !keyB64 || !ipHeader) return null;
  const signCertPath = env.ENROLLMENT_PROFILE_SIGN_CERT_PATH || null;
  const signKeyPath = env.ENROLLMENT_PROFILE_SIGN_KEY_PATH || null;
  // Signing material is all-or-nothing; a half-configured signer is a
  // misconfiguration, not a silent fallback to an unsigned profile.
  if ((signCertPath === null) !== (signKeyPath === null)) return null;
  if (signCertPath && signKeyPath
    && (signCertPath.length > 512 || signKeyPath.length > 512
      || /[\u0000-\u001f\u007f]/.test(signCertPath) || /[\u0000-\u001f\u007f]/.test(signKeyPath)))
    return null;
  try {
    const origin = new URL(appOrigin), db = new URL(supabaseUrl);
    if (origin.origin !== appOrigin || db.origin !== supabaseUrl) return null;
    if (!origin.origin.startsWith("https://") || !db.origin.startsWith("https://")) return null;
    if (origin.username || origin.password || origin.hash || db.username || db.password || db.hash) return null;
    if (!/^[a-z0-9-]+$/i.test(ipHeader)) return null;
    return {
      appOrigin: origin.origin, supabaseUrl: db.origin, serviceKey,
      encryptionKey: keyFromBase64(keyB64), trustedIpHeader: ipHeader.toLowerCase(),
      signCertPath, signKeyPath
    };
  } catch { return null; }
}

export function getSelfProfileConfig(): SelfProfileConfig | null {
  return parseSelfProfileConfig(process.env);
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Deterministic RFC 4122 v5-style UUID derived from a seed (stable per session). */
export function uuidFromSeed(seed: string): string {
  const bytes = Buffer.from(sha256("an-ipa:mobileconfig:" + seed), "hex").subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toUpperCase();
}

/**
 * Build the Profile Service .mobileconfig for one enrollment session.
 * Structure follows Apple's archived Profile Service documentation: a
 * top-level Configuration profile whose single payload has the literal type
 * "Profile Service", the callback URL on our own origin, the requested
 * DeviceAttributes and the one-time session Challenge. The device posts the
 * attributes back to the URL when the person installs the profile.
 */
export function buildProfileServiceMobileconfig(input: { appOrigin: string; challenge: string }): string {
  if (!CHALLENGE_FORMAT.test(input.challenge)) throw new Error("Invalid enrollment challenge");
  const callbackUrl = input.appOrigin + PROFILE_CALLBACK_PATH;
  const contentUuid = uuidFromSeed(input.challenge + ":payload");
  const profileUuid = uuidFromSeed(input.challenge + ":profile");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    APPLE_PLIST_DOCTYPE,
    '<plist version="1.0">',
    "<dict>",
    "\t<key>PayloadContent</key>",
    "\t<dict>",
    "\t\t<key>URL</key>",
    `\t\t<string>${xmlEscape(callbackUrl)}</string>`,
    "\t\t<key>DeviceAttributes</key>",
    "\t\t<array>",
    "\t\t\t<string>UDID</string>",
    "\t\t\t<string>PRODUCT</string>",
    "\t\t\t<string>VERSION</string>",
    "\t\t\t<string>SERIAL</string>",
    "\t\t</array>",
    "\t\t<key>Challenge</key>",
    `\t\t<string>${xmlEscape(input.challenge)}</string>`,
    "\t\t<key>PayloadDescription</key>",
    "\t\t<string>Gửi UDID và thông tin cơ bản của thiết bị này về AN IPA STORE.</string>",
    "\t\t<key>PayloadDisplayName</key>",
    "\t\t<string>AN IPA STORE — Lấy UDID</string>",
    "\t\t<key>PayloadIdentifier</key>",
    "\t\t<string>dev.anipastore.udid.profile-service</string>",
    "\t\t<key>PayloadType</key>",
    "\t\t<string>Profile Service</string>",
    "\t\t<key>PayloadUUID</key>",
    `\t\t<string>${contentUuid}</string>`,
    "\t\t<key>PayloadVersion</key>",
    "\t\t<integer>1</integer>",
    "\t</dict>",
    "\t<key>PayloadDescription</key>",
    "\t<string>Hồ sơ tạm thời: iPhone sẽ gửi UDID của chính thiết bị này về AN IPA STORE để kiểm tra điều kiện cài ứng dụng. Hồ sơ không cài thêm ứng dụng và có thể gỡ bất cứ lúc nào trong Cài đặt.</string>",
    "\t<key>PayloadDisplayName</key>",
    "\t<string>AN IPA STORE — Lấy UDID</string>",
    "\t<key>PayloadIdentifier</key>",
    "\t<string>dev.anipastore.udid</string>",
    "\t<key>PayloadOrganization</key>",
    "\t<string>AN IPA STORE</string>",
    "\t<key>PayloadType</key>",
    "\t<string>Configuration</string>",
    "\t<key>PayloadUUID</key>",
    `\t<string>${profileUuid}</string>`,
    "\t<key>PayloadVersion</key>",
    "\t<integer>1</integer>",
    "</dict>",
    "</plist>",
    ""
  ].join("\n");
}

export interface DeviceReportedAttributes {
  udid: string;
  challenge: string;
  product?: string;
  version?: string;
  serial?: string;
}

/**
 * Strict parser for a device-reported attribute plist. Same deliberately
 * narrow grammar as the verified CMS parser (flat string/data dictionary,
 * no DTD/entities/nesting/duplicate keys) with two pragmatic differences:
 * string values may contain a comma (real PRODUCT values look like
 * "iPhone16,2") and the challenge is format-checked here while the actual
 * session match is enforced atomically in SQL by the completion RPC.
 * This parser performs NO authenticity check: the input is untrusted.
 */
export function parseDeviceReportedAttributes(xml: string): DeviceReportedAttributes {
  if (Buffer.byteLength(xml) > MAX_PLIST_BYTES || xml.includes("\u0000"))
    throw new Error("Device payload too large");
  let contents = xml.trim().replace(/^<\?xml\s+version="1\.0"\s+encoding="UTF-8"\s*\?>/i, "").trim();
  if (contents.startsWith("<!DOCTYPE")) {
    if (!contents.startsWith(APPLE_PLIST_DOCTYPE)) throw new Error("Unexpected plist declaration");
    contents = contents.slice(APPLE_PLIST_DOCTYPE.length).trim();
  }
  if (/<!|<\?|&[#a-z]/i.test(contents)) throw new Error("Unsupported XML markup");
  if (!/^<plist\s+version="1\.0">\s*<dict>[\s\S]*<\/dict>\s*<\/plist>$/.test(contents))
    throw new Error("Expected a top-level plist dictionary");
  const inner = contents.replace(/^<plist\s+version="1\.0">\s*<dict>/, "")
    .replace(/<\/dict>\s*<\/plist>$/, "").trim();
  const fields = new Map<string, string>();
  const pair = /<key>([A-Z_]{1,40})<\/key>\s*<(string|data)>([A-Za-z0-9_+/\-=.,]{0,512})<\/\2>/y;
  let offset = 0;
  while (offset < inner.length) {
    while (/\s/.test(inner[offset] || "") && offset < inner.length) offset++;
    if (offset === inner.length) break;
    pair.lastIndex = offset;
    const match = pair.exec(inner);
    if (!match) throw new Error("Unsupported device attribute field");
    const [, name, type, value] = match;
    if (fields.has(name)) throw new Error("Duplicate device attribute");
    let parsed = value;
    if (type === "data") {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
        throw new Error("Invalid base64 device attribute");
      parsed = Buffer.from(value, "base64").toString("utf8");
    }
    fields.set(name, parsed);
    offset = pair.lastIndex;
  }
  const challenge = fields.get("CHALLENGE");
  if (!challenge || !CHALLENGE_FORMAT.test(challenge))
    throw new Error("Missing or malformed profile challenge");
  const rawUdid = fields.get("UDID");
  if (!rawUdid) throw new Error("Missing UDID");
  // normalizeUdid throws on any malformed UDID; garbage never reaches storage.
  const result: DeviceReportedAttributes = { udid: normalizeUdid(rawUdid), challenge };
  const product = fields.get("PRODUCT"), version = fields.get("VERSION"), serial = fields.get("SERIAL");
  if (product) result.product = product.slice(0, 64);
  if (version) result.version = version.slice(0, 32);
  if (serial) result.serial = serial.slice(0, 64);
  return result;
}

/**
 * Extract the attribute plist from a raw device POST body. Accepts the three
 * shapes seen in the wild: a plain XML plist, a PEM-wrapped CMS blob, or a
 * DER CMS/PKCS#7 blob. CMS input is opened with `openssl cms -verify
 * -noverify`: the embedded signature is used as an envelope only and the
 * signer certificate chain is deliberately NOT checked — see the trust note
 * at the top of this file. Never log the body or OpenSSL stderr.
 */
export async function extractDeviceReportedAttributes(body: Buffer): Promise<DeviceReportedAttributes> {
  if (!Buffer.isBuffer(body) || body.length === 0 || body.length > MAX_DEVICE_RESPONSE_BYTES)
    throw new Error("Invalid device response size");
  const head = body.subarray(0, 512).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<plist") || head.startsWith("<!DOCTYPE"))
    return parseDeviceReportedAttributes(body.toString("utf8"));
  const isPem = head.startsWith("-----BEGIN");
  const dir = await mkdtemp(join(tmpdir(), "an-ipa-self-profile-"));
  try {
    const input = join(dir, "device-response.bin"), content = join(dir, "attributes.xml");
    await writeFile(input, body, { mode: 0o600 });
    try {
      await runFile("openssl", [
        "cms", "-verify", "-noverify", "-inform", isPem ? "PEM" : "DER",
        ...(isPem ? [] : ["-binary"]),
        "-in", input, "-out", content
      ], { timeout: 5000, maxBuffer: 65536 });
    } catch {
      throw new Error("Device response could not be opened");
    }
    const buf = await readFile(content);
    if (buf.length > MAX_PLIST_BYTES) throw new Error("Device response too large");
    return parseDeviceReportedAttributes(buf.toString("utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Optionally sign the .mobileconfig with an operator-provided PEM cert+key
 * (for example the domain's own TLS certificate from the secret manager), so
 * iOS shows the profile as signed instead of the red "Not Signed" warning.
 * Signing identity says nothing about Apple: it only proves the profile came
 * from whoever controls that certificate. Cert/key live outside the repo and
 * are referenced by filesystem path only; nothing is committed.
 */
export async function signMobileconfig(xml: Buffer, certPath: string, keyPath: string): Promise<Buffer> {
  if (!Buffer.isBuffer(xml) || xml.length === 0 || xml.length > 64 * 1024)
    throw new Error("Invalid profile size");
  const dir = await mkdtemp(join(tmpdir(), "an-ipa-profile-sign-"));
  try {
    const input = join(dir, "profile.plist"), output = join(dir, "profile.mobileconfig");
    await writeFile(input, xml, { mode: 0o600 });
    try {
      await runFile("openssl", [
        "smime", "-sign", "-binary", "-nodetach", "-outform", "DER",
        "-in", input, "-signer", certPath, "-inkey", keyPath, "-out", output
      ], { timeout: 5000, maxBuffer: 65536 });
    } catch {
      // Never echo OpenSSL stderr or key paths into responses/logs.
      throw new Error("Profile signing failed");
    }
    const signed = await readFile(output);
    if (signed.length === 0 || signed.length > 256 * 1024) throw new Error("Invalid signed profile");
    return signed;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
