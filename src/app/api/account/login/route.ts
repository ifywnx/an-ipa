import {NextRequest, NextResponse} from "next/server";
import {customerConfig} from "@/modules/auth/customer-server";
import {fetchCustomerUser, sealCustomerSession, tokensFromGrantResponse} from "@/modules/auth/customer";
import {
  accountHeaders, accountReject, accountUnavailable, checkOrigin,
  parseCredentials, readJsonBody, sessionCookieOptions,
} from "@/modules/accounts/route-helpers";
import {CUSTOMER_COOKIE} from "@/modules/auth/customer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Customer password sign-in via Supabase Auth. A confirmed, unbanned
 *  account is enough — unlike Admin there is intentionally NO role check.
 *  The response never reveals whether the email exists. */
export async function POST(request: NextRequest) {
  const cfg = customerConfig();
  if (!cfg) return accountUnavailable();
  if (!checkOrigin(request, cfg)) return accountReject(403, "BAD_ORIGIN", "Yêu cầu không hợp lệ.");
  const credentials = parseCredentials(await readJsonBody(request));
  if (!credentials) return accountReject(400, "BAD_REQUEST", "Email hoặc mật khẩu không đúng định dạng.");
  try {
    const response = await fetch(cfg.supabaseUrl + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: {apikey: cfg.publishableKey, "Content-Type": "application/json"},
      body: JSON.stringify({email: credentials.email, password: credentials.password}),
      signal: AbortSignal.timeout(8000), cache: "no-store",
    });
    if (!response.ok)
      return accountReject(401, "INVALID_CREDENTIALS", "Email hoặc mật khẩu chưa chính xác, hoặc email chưa được xác thực.");
    const now = Date.now();
    const tokens = tokensFromGrantResponse(await response.json() as unknown, now);
    if (!tokens) return accountReject(401, "INVALID_CREDENTIALS", "Đăng nhập không thành công.");
    const user = await fetchCustomerUser(tokens.accessToken, cfg);
    if (!user) return accountReject(401, "INVALID_CREDENTIALS", "Email hoặc mật khẩu chưa chính xác, hoặc email chưa được xác thực.");
    const session = {...tokens, issuedAt: now};
    const result = NextResponse.json({ok: true, user}, {headers: accountHeaders});
    result.cookies.set(CUSTOMER_COOKIE,
      sealCustomerSession(session, cfg.sessionKey), sessionCookieOptions(session, now));
    return result;
  } catch { return accountUnavailable(); }
}
