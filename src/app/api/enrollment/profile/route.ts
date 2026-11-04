import { NextRequest } from "next/server";
import { enrollmentDb, enrollmentHeaders, tokenHash, unavailable } from "@/modules/enrollment/server";
import { buildProfileServiceMobileconfig, getSelfProfileConfig, signMobileconfig } from "@/modules/enrollment/self-profile";
export const runtime = "nodejs";
interface Row { status: string; expires_at: string }

/**
 * Serves the self-hosted Profile Service .mobileconfig for one enrollment
 * session. Only reachable in self-profile mode and only for a challenge that
 * /api/enrollment/start created moments ago: the row must still be pending
 * and unexpired. The challenge is a 256-bit one-time secret in the URL —
 * the same trust shape as the external provider URL in provider mode.
 */
export async function GET(request: NextRequest) {
  const config = getSelfProfileConfig();
  if (!config) return unavailable();
  const challenge = request.nextUrl.searchParams.get("challenge") ?? "";
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(challenge))
    return Response.json({ error: "INVALID_CHALLENGE" }, { status: 400, headers: enrollmentHeaders });
  let row: Row | undefined;
  try {
    const rows = await enrollmentDb<Row[]>(config,
      "guest_enrollments?select=status,expires_at&challenge_hash=eq." + tokenHash(challenge) + "&limit=1");
    row = rows[0];
  } catch {
    return Response.json({ error: "ENROLLMENT_UNAVAILABLE" }, { status: 503, headers: enrollmentHeaders });
  }
  if (!row) return Response.json({ error: "CHALLENGE_NOT_FOUND" }, { status: 404, headers: enrollmentHeaders });
  if (row.status !== "pending")
    return Response.json({ error: "CHALLENGE_ALREADY_USED" }, { status: 409, headers: enrollmentHeaders });
  if (!Number.isFinite(Date.parse(row.expires_at)) || Date.now() >= Date.parse(row.expires_at))
    return Response.json({ error: "CHALLENGE_EXPIRED" }, { status: 410, headers: enrollmentHeaders });
  const xml = buildProfileServiceMobileconfig({ appOrigin: config.appOrigin, challenge });
  const headers = new Headers(enrollmentHeaders);
  headers.set("Content-Type", "application/x-apple-aspen-config");
  headers.set("Content-Disposition", 'attachment; filename="an-ipa-store-udid.mobileconfig"');
  if (config.signCertPath && config.signKeyPath) {
    try {
      const signed = await signMobileconfig(Buffer.from(xml, "utf8"), config.signCertPath, config.signKeyPath);
      return new Response(new Uint8Array(signed), { headers });
    } catch {
      // Signing was explicitly configured: fail closed instead of silently
      // downgrading to an unsigned profile the operator did not approve.
      return Response.json({ error: "PROFILE_SIGNING_UNAVAILABLE" }, { status: 503, headers: enrollmentHeaders });
    }
  }
  return new Response(xml, { headers });
}
