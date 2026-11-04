import {NextRequest, NextResponse} from "next/server";
import {customerConfig} from "@/modules/auth/customer-server";
import {
  customerAuthCallbackUrl, fetchCustomerUser, sealCustomerSession,
  tokensFromGrantResponse, validCustomerUser,
} from "@/modules/auth/customer";
import {
  accountHeaders, accountReject, accountUnavailable, checkOrigin,
  parseCredentials, readJsonBody, sessionCookieOptions,
} from "@/modules/accounts/route-helpers";
import {CUSTOMER_COOKIE} from "@/modules/auth/customer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Customer registration via Supabase Auth signup. Passwords are handled by
 *  Supabase only — never stored or logged here. When the project requires
 *  email confirmation (the expected configuration), no session is issued
 *  until the customer confirms through the emailed link. */
export async function POST(request: NextRequest) {
  const cfg = customerConfig();
  if (!cfg) return accountUnavailable();
  if (!checkOrigin(request, cfg)) return accountReject(403, "BAD_ORIGIN", "Yêu cầu không hợp lệ.");
  const credentials = parseCredentials(await readJsonBody(request));
  if (!credentials) return accountReject(400, "BAD_REQUEST", "Email không đúng định dạng hoặc mật khẩu cần 8–256 ký tự.");
  try {
    const url = new URL("/auth/v1/signup", cfg.supabaseUrl);
    url.searchParams.set("redirect_to", customerAuthCallbackUrl(cfg));
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {apikey: cfg.publishableKey, "Content-Type": "application/json"},
      body: JSON.stringify({email: credentials.email, password: credentials.password}),
      signal: AbortSignal.timeout(8000), cache: "no-store",
    });
    if (!response.ok)
      return accountReject(400, "SIGNUP_REJECTED", "Không tạo được tài khoản. Email có thể đã được đăng ký hoặc mật khẩu chưa đạt yêu cầu.");
    const json: unknown = await response.json();
    const now = Date.now();
    const tokens = tokensFromGrantResponse(json, now);
    const rawUser = json && typeof json === "object"
      ? (json as {user?: unknown}).user : undefined;
    if (tokens && validCustomerUser(rawUser)) {
      // Confirmation is disabled in the project, or the account was already
      // confirmed: verify freshly, then issue the customer session.
      const user = await fetchCustomerUser(tokens.accessToken, cfg);
      if (user) {
        const session = {...tokens, issuedAt: now};
        const result = NextResponse.json({ok: true, confirmed: true, user}, {headers: accountHeaders});
        result.cookies.set(CUSTOMER_COOKIE,
          sealCustomerSession(session, cfg.sessionKey), sessionCookieOptions(session, now));
        return result;
      }
    }
    return NextResponse.json(
      {ok: true, confirmed: false,
       message: "Đã tạo tài khoản. Hãy mở email và bấm liên kết xác thực, sau đó đăng nhập."},
      {headers: accountHeaders});
  } catch { return accountUnavailable(); }
}
