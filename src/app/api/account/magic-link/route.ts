import {NextRequest, NextResponse} from "next/server";
import {customerConfig} from "@/modules/auth/customer-server";
import {customerAuthCallbackUrl} from "@/modules/auth/customer";
import {
  accountHeaders, accountReject, accountUnavailable, checkOrigin,
  parseEmail, readJsonBody,
} from "@/modules/accounts/route-helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Passwordless sign-in link via Supabase Auth OTP. The response is the
 *  same whether or not the email has an account, so the endpoint cannot be
 *  used to enumerate customers. The emailed link lands on /auth/callback,
 *  which hands the token pair to POST /api/account/session. */
export async function POST(request: NextRequest) {
  const cfg = customerConfig();
  if (!cfg) return accountUnavailable();
  if (!checkOrigin(request, cfg)) return accountReject(403, "BAD_ORIGIN", "Yêu cầu không hợp lệ.");
  const email = parseEmail(await readJsonBody(request));
  if (!email) return accountReject(400, "BAD_REQUEST", "Email không đúng định dạng.");
  try {
    const url = new URL("/auth/v1/otp", cfg.supabaseUrl);
    url.searchParams.set("redirect_to", customerAuthCallbackUrl(cfg));
    await fetch(url.toString(), {
      method: "POST",
      headers: {apikey: cfg.publishableKey, "Content-Type": "application/json"},
      body: JSON.stringify({email, create_user: true}),
      signal: AbortSignal.timeout(8000), cache: "no-store",
    });
  } catch { /* generic answer either way */ }
  return NextResponse.json(
    {ok: true, message: "Nếu email hợp lệ, liên kết đăng nhập đã được gửi. Hãy mở liên kết trong email để tiếp tục."},
    {headers: accountHeaders});
}
