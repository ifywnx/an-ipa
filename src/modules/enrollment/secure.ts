import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv, createPublicKey, verify as verifySignature } from "node:crypto";
import { normalizeUdid } from "../devices/policy";

export const sha256 = (input: string): string => createHash("sha256").update(input).digest("hex");
export const randomToken = (): string => randomBytes(32).toString("base64url");
export function keyFromBase64(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes");
  return key;
}
export function keyedHash(key: Buffer, purpose: "ip" | "udid", value: string): string {
  return createHmac("sha256", key).update("an-ipa:" + purpose + ":" + value).digest("hex");
}
export function encryptUdid(key: Buffer, value: string): string {
  const udid = normalizeUdid(value);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(udid, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString("base64url")).join(".");
}
export function decryptUdid(key: Buffer, sealed: string): string {
  const chunks = sealed.split(".");
  if (chunks.length !== 3) throw new Error("Invalid ciphertext");
  const [iv, tag, ciphertext] = chunks.map(x => Buffer.from(x, "base64url"));
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return normalizeUdid(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
}
export interface VerifiedDeviceAttestation {
  protocol: "apple-profile-service-cms-v1";
  issuer: string;
  audience: string;
  challenge: string;
  udid: string;
  issued_at: string;
  provider_reference: string;
  device_signature_verified: true;
  apple_device_chain_trusted: true;
}
export function verifyProviderAttestation(
  rawBody: string, base64Signature: string, spkiDerBase64: string,
  audience: string, issuer: string, now = new Date()
): VerifiedDeviceAttestation {
  if (rawBody.length > 4096 || base64Signature.length > 256) throw new Error("Invalid attestation size");
  const publicKey = createPublicKey({ key: Buffer.from(spkiDerBase64,"base64"), format:"der", type:"spki" });
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Verifier key type is not Ed25519");
  const signature = Buffer.from(base64Signature,"base64");
  if (signature.length !== 64 || !verifySignature(null, Buffer.from(rawBody,"utf8"), publicKey, signature))
    throw new Error("Untrusted device attestation");
  const v: unknown = JSON.parse(rawBody);
  if (!v || typeof v !== "object") throw new Error("Malformed device attestation");
  const a = v as Record<string,unknown>;
  if (a.protocol !== "apple-profile-service-cms-v1" || a.issuer !== issuer || a.audience !== audience
    || a.device_signature_verified !== true || a.apple_device_chain_trusted !== true
    || typeof a.challenge !== "string" || !/^[A-Za-z0-9_-]{40,64}$/.test(a.challenge)
    || typeof a.udid !== "string" || typeof a.issued_at !== "string"
    || typeof a.provider_reference !== "string" || a.provider_reference.length > 120)
    throw new Error("Incomplete verification evidence");
  const issued = Date.parse(a.issued_at);
  if (!Number.isFinite(issued) || Math.abs(now.getTime() - issued) > 120_000) throw new Error("Expired verification evidence");
  const udid = normalizeUdid(a.udid);
  return { protocol:"apple-profile-service-cms-v1", issuer, audience, challenge:a.challenge,
    udid, issued_at:a.issued_at, provider_reference:a.provider_reference,
    device_signature_verified:true, apple_device_chain_trusted:true };
}
