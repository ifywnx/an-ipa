import { NextRequest, NextResponse } from "next/server";
import { getEnrollmentConfig, enrollmentDb, enrollmentHeaders, unavailable, tokenHash } from "@/modules/enrollment/server";
import { getSelfProfileConfig } from "@/modules/enrollment/self-profile";
import { randomToken, keyedHash } from "@/modules/enrollment/secure";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  // Provider mode (external verified Profile Service) always wins when it is
  // configured: it is the only path whose completion can mark a session
  // 'verified'. Self-profile mode is the pragmatic fallback — its sessions
  // can only ever complete as device-reported. Session creation, the
  // one-time challenge, cookie and SQL rate limit are identical either way.
  const provider = getEnrollmentConfig();
  const self = provider ? null : getSelfProfileConfig();
  const config = provider ?? self;
  if (!config) return unavailable();
  if (request.headers.get("origin") !== config.appOrigin ||
    !request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ error:"INVALID_ORIGIN" }, { status:403, headers:enrollmentHeaders });
  const sourceIp = request.headers.get(config.trustedIpHeader);
  if (!sourceIp || sourceIp.length > 64 || !/^[0-9a-f:.]+$/i.test(sourceIp))
    return Response.json({error:"TRUSTED_EDGE_REQUIRED"}, {status:503, headers:enrollmentHeaders});
  let payload: unknown;
  try {
    if (Number(request.headers.get("content-length") || 0) > 1024) throw new Error("Too large");
    payload = await request.json();
  } catch { return Response.json({error:"INVALID_REQUEST"}, {status:400, headers:enrollmentHeaders}); }
  if (!payload || typeof payload !== "object" || (payload as {consent?:unknown}).consent !== true)
    return Response.json({error:"CONSENT_REQUIRED"}, {status:400, headers:enrollmentHeaders});
  const browser = randomToken(), challenge = randomToken();
  const expiry = new Date(Date.now()+8*60*1000);
  try {
    await enrollmentDb<string>(config,"rpc/create_guest_enrollment", {
      method:"POST", body:JSON.stringify({
        p_browser_hash:tokenHash(browser), p_challenge_hash:tokenHash(challenge),
        p_ip_hmac:keyedHash(config.encryptionKey,"ip",sourceIp), p_expires_at:expiry.toISOString()
      })
    });
  } catch {
    return Response.json({error:"ENROLLMENT_UNAVAILABLE_OR_RATE_LIMITED"}, {status:429, headers:enrollmentHeaders});
  }
  let profileUrl: string;
  let mode: "provider" | "self_profile";
  if (provider) {
    // Only a separately trusted Profile Service provider may serve a real
    // .mobileconfig, validate the Apple CMS chain and sign a verification
    // assertion in this mode.
    const enrollUrl = new URL(provider.providerStartUrl);
    enrollUrl.searchParams.set("challenge", challenge);
    enrollUrl.searchParams.set("return_to", config.appOrigin+"/udid");
    profileUrl = enrollUrl.toString();
    mode = "provider";
  } else {
    // Self-profile mode: our own endpoint serves the .mobileconfig for this
    // exact challenge; the device reports back to our own callback.
    profileUrl = config.appOrigin + "/api/enrollment/profile?challenge=" + encodeURIComponent(challenge);
    mode = "self_profile";
  }
  const response = NextResponse.json({ status:"pending", mode, profileUrl, expiresAt:expiry.toISOString() },
    { headers:enrollmentHeaders });
  response.cookies.set("an_enrollment", browser,
    {httpOnly:true,secure:true,sameSite:"lax",path:"/api/enrollment",expires:expiry});
  return response;
}
