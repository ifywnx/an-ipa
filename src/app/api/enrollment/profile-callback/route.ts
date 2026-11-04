import { NextRequest } from "next/server";
import { enrollmentDb, enrollmentHeaders, tokenHash, unavailable } from "@/modules/enrollment/server";
import { extractDeviceReportedAttributes, getSelfProfileConfig, MAX_DEVICE_RESPONSE_BYTES } from "@/modules/enrollment/self-profile";
import { customerConfig } from "@/modules/auth/customer-server";
import { linkSelfProfileRequest, type AccountDbClient } from "@/modules/accounts/ownership";
import { encryptUdid, keyedHash, randomToken } from "@/modules/enrollment/secure";
export const runtime = "nodejs";

/**
 * Device callback for self-profile mode. The iPhone POSTs its attributes
 * here after the person installs the profile. The body is UNTRUSTED,
 * self-asserted data: CMS input is opened with openssl -noverify purely to
 * extract the plist (see self-profile.ts). A successful callback completes
 * the guest session as 'device_reported' — never 'verified' — and records
 * the UDID on the pending_unverified admin path with source='self_profile'.
 */
export async function POST(request: NextRequest) {
  const config = getSelfProfileConfig();
  if (!config) return unavailable();
  if (Number(request.headers.get("content-length") || 0) > MAX_DEVICE_RESPONSE_BYTES)
    return Response.json({ error: "DEVICE_RESPONSE_TOO_LARGE" }, { status: 413, headers: enrollmentHeaders });
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length === 0 || body.length > MAX_DEVICE_RESPONSE_BYTES)
    return Response.json({ error: "DEVICE_RESPONSE_TOO_LARGE" }, { status: 413, headers: enrollmentHeaders });
  let reported;
  try {
    reported = await extractDeviceReportedAttributes(body);
  } catch {
    return Response.json({ error: "DEVICE_RESPONSE_UNREADABLE" }, { status: 400, headers: enrollmentHeaders });
  }
  // The RPC is the atomic gate: it completes only a session that is still
  // pending and unexpired for this exact challenge hash, exactly once.
  // Wrong challenge, expiry and replay all surface as `false` here.
  let completed: boolean;
  try {
    completed = await enrollmentDb<boolean>(config, "rpc/complete_guest_enrollment_self_report", {
      method: "POST",
      body: JSON.stringify({
        p_challenge_hash: tokenHash(reported.challenge),
        p_udid_ciphertext: encryptUdid(config.encryptionKey, reported.udid),
        p_udid_hmac: keyedHash(config.encryptionKey, "udid", reported.udid)
      })
    });
  } catch {
    return Response.json({ error: "ENROLLMENT_UNAVAILABLE" }, { status: 503, headers: enrollmentHeaders });
  }
  if (completed !== true)
    return Response.json({ error: "CHALLENGE_INVALID_EXPIRED_OR_USED" }, { status: 409, headers: enrollmentHeaders });
  // Best-effort second record for the owner: the same pending_unverified
  // queue as manual submissions, honestly labelled source='self_profile'.
  // A duplicate/rate-limit rejection must not fail the guest flow — the
  // UDID is then already pending, and the guest session above holds a copy
  // for the browser that started it.
  const sourceIp = request.headers.get(config.trustedIpHeader);
  if (sourceIp && sourceIp.length <= 64 && /^[0-9a-f:.]+$/i.test(sourceIp)) {
    try {
      await enrollmentDb<string>(config, "rpc/submit_self_profile_udid_request", {
        method: "POST",
        body: JSON.stringify({
          p_request_token_hash: tokenHash(randomToken()),
          p_ip_hmac: keyedHash(config.encryptionKey, "ip", sourceIp),
          p_udid_ciphertext: encryptUdid(config.encryptionKey, reported.udid),
          p_udid_hmac: keyedHash(config.encryptionKey, "udid", reported.udid),
          p_udid_suffix: reported.udid.slice(-4)
        })
      });
    } catch { /* already pending or rate limited; nothing sensitive to log */ }
    // If the enrollment session was started by a signed-in customer, pass
    // its ownership to the pending request (the SQL reads the owner from
    // the session row; nothing here supplies a user id). Best effort and
    // only when customer accounts are configured at all.
    if (customerConfig()) {
      try {
        const accountDb: AccountDbClient = {
          select: async () => [],
          rpc: (name, body) => enrollmentDb(config, "rpc/" + name, {
            method: "POST", body: JSON.stringify(body)
          }),
        };
        await linkSelfProfileRequest(accountDb, tokenHash(reported.challenge));
      } catch { /* ownership link is bookkeeping, never a flow failure */ }
    }
  }
  // Send the device back to the store's own /udid page so the person sees
  // their UDID. Same-origin by construction: the target is built from the
  // configured APP_ORIGIN, never from request data.
  const headers = new Headers(enrollmentHeaders);
  headers.set("Location", config.appOrigin + "/udid");
  return new Response(null, { status: 301, headers });
}
