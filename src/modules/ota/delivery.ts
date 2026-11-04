import { createHash, createHmac } from "node:crypto";
import { validateR2, type PrivateR2 } from "../ipa/r2-presign";

/**
 * Short-lived presigned GET for a private R2 artifact, SERVER SIDE only.
 * The manifest never references R2 directly: iOS is sent to the store's own
 * /api/ota/download/<token> route, which re-validates the grant and only
 * then redirects to a URL minted here (TTL <= 300s and <= grant remainder).
 */
export const MAX_SIGNED_GET_TTL_SECONDS = 300;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}
function enc(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) =>
    "%" + ch.charCodeAt(0).toString(16).toUpperCase());
}

export function isSafeObjectKey(objectKey: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9/_\-.]{0,511}$/.test(objectKey)
    && !objectKey.split("/").some((part) => part === ".." || part === ".");
}

export function presignPrivateObjectGet(
  config: PrivateR2,
  objectKey: string,
  expiresSeconds: number,
  now: Date = new Date(),
): string {
  if (!validateR2(config)) throw new Error("R2_CONFIGURATION_INVALID");
  if (!isSafeObjectKey(objectKey)) throw new Error("R2_OBJECT_KEY_INVALID");
  if (!Number.isSafeInteger(expiresSeconds)
    || expiresSeconds < 1 || expiresSeconds > MAX_SIGNED_GET_TTL_SECONDS) {
    throw new Error("R2_SIGNED_GET_TTL_OUT_OF_RANGE");
  }
  if (!Number.isFinite(now.getTime())) throw new Error("R2_TIMESTAMP_INVALID");
  const host = config.accountId.toLowerCase() + ".r2.cloudflarestorage.com";
  const path = "/" + enc(config.bucket) + "/" + objectKey.split("/").map(enc).join("/");
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = date.slice(0, 8);
  const scope = day + "/auto/s3/aws4_request";
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
    "X-Amz-Credential": config.accessKeyId + "/" + scope,
    "X-Amz-Date": date,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const query = Object.entries(params).map(([k, v]) => enc(k) + "=" + enc(v)).sort().join("&");
  const canonical = "GET\n" + path + "\n" + query + "\nhost:" + host + "\n\nhost\nUNSIGNED-PAYLOAD";
  const stringToSign = "AWS4-HMAC-SHA256\n" + date + "\n" + scope + "\n" + sha256Hex(canonical);
  const signingKey = hmac(hmac(hmac(hmac("AWS4" + config.secretAccessKey, day), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return "https://" + host + path + "?" + query + "&X-Amz-Signature=" + signature;
}
