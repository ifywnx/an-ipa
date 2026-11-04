import {NextRequest, NextResponse} from "next/server";
import {customerConfig, customerFromRequest} from "@/modules/auth/customer-server";
import {
  CUSTOMER_COOKIE, fetchCustomerUser, refreshCustomerTokens, sealCustomerSession,
} from "@/modules/auth/customer";
import {
  accountHeaders, accountReject, accountUnavailable, applyCookieUpdate,
  checkOrigin, jwtExpiryMs, readJsonBody, sessionCookieOptions,
} from "@/modules/accounts/route-helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current account state for client UI; rotates the session cookie when
 *  the access token had to be refreshed. user is null when logged out. */
export async function GET(request: NextRequest) {
  const cfg = customerConfig();
  if (!cfg) return accountUnavailable();
  const resolved = await customerFromRequest(request);
  if (!resolved)
    return NextResponse.json({ok: true, user: null}, {headers: accountHeaders});
  return applyCookieUpdate(
    NextResponse.json({ok: true, user: resolved.user}, {headers: accountHeaders}),
    resolved.cookieUpdate);
}

/**
 * Establish a session from a token pair delivered in the URL fragment by
 * Supabase (email confirmation, magic link, Google OAuth). Fragments never
 * reach the server, so the /auth/callback page posts the pair here; the
 * access token is verified against Supabase before any cookie is sealed.
 */
export async function POST(request: NextRequest) {
  const cfg = customerConfig();
  if (!cfg) return accountUnavailable();
  if (!checkOrigin(request, cfg)) return accountReject(403, "BAD_ORIGIN", "Yêu cầu không hợp lệ.");
  const body = await readJsonBody(request, 10000);
  const v = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (typeof v.accessToken !== "string" || typeof v.refreshToken !== "string"
    || v.accessToken.length > 4096 || v.refreshToken.length > 4096)
    return accountReject(400, "BAD_REQUEST", "Phiên đăng nhập không hợp lệ.");
  try {
    const now = Date.now();
    let accessToken = v.accessToken, refreshToken = v.refreshToken;
    let expiresAt = jwtExpiryMs(accessToken) ?? 0;
    if (expiresAt <= now + 60_000) {
      const refreshed = await refreshCustomerTokens(refreshToken, cfg, fetch, now);
      if (!refreshed) return accountReject(401, "SESSION_EXPIRED", "Liên kết đăng nhập đã hết hạn. Hãy yêu cầu liên kết mới.");
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      expiresAt = refreshed.expiresAt;
    }
    const user = await fetchCustomerUser(accessToken, cfg);
    if (!user) return accountReject(401, "SESSION_INVALID", "Không xác minh được phiên đăng nhập.");
    const session = {accessToken, refreshToken, expiresAt, issuedAt: now};
    const result = NextResponse.json({ok: true, user}, {headers: accountHeaders});
    result.cookies.set(CUSTOMER_COOKIE,
      sealCustomerSession(session, cfg.sessionKey), sessionCookieOptions(session, now));
    return result;
  } catch { return accountUnavailable(); }
}
