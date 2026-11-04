import {NextRequest, NextResponse} from "next/server";
import {customerConfig, customerFromRequest} from "@/modules/auth/customer-server";
import {createAccountDbClient} from "@/modules/accounts/server";
import {claimBrowserDevices, type BrowserCredentials} from "@/modules/accounts/ownership";
import {tokenHash} from "@/modules/enrollment/server";
import {sameOrigin} from "@/modules/auth/session";
import {accountHeaders, accountReject, accountUnavailable, applyCookieUpdate} from "@/modules/accounts/route-helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANUAL_COOKIE = "an_manual_udid";
const ENROLLMENT_COOKIE = "an_enrollment";
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{40,64}$/;

/**
 * Claim what THIS browser submitted while logged out into the signed-in
 * account. The request carries no identifiers at all: the server reads the
 * browser's own intake cookies, hashes them, and the claim RPCs match rows
 * by credential hash that are still unowned. A record belonging to another
 * account can never be taken over here, and there is no way to claim by
 * typing an identifier — possession of the original browser is the proof.
 */
export async function POST(request: NextRequest) {
  const cfg = customerConfig();
  if (!cfg) return accountUnavailable();
  if (!sameOrigin(request.headers.get("origin"), cfg.origin))
    return accountReject(403, "BAD_ORIGIN", "Yêu cầu không hợp lệ.");
  const resolved = await customerFromRequest(request);
  if (!resolved) return accountReject(401, "AUTH_REQUIRED", "Hãy đăng nhập trước khi nhận thiết bị.");
  const credentials: BrowserCredentials = {};
  const manual = request.cookies.get(MANUAL_COOKIE)?.value;
  if (manual && TOKEN_FORMAT.test(manual)) credentials.manualTokenHash = tokenHash(manual);
  const enrollment = request.cookies.get(ENROLLMENT_COOKIE)?.value;
  if (enrollment && TOKEN_FORMAT.test(enrollment)) credentials.enrollmentBrowserHash = tokenHash(enrollment);
  if (!credentials.manualTokenHash && !credentials.enrollmentBrowserHash)
    return NextResponse.json(
      {ok: true, claimed: 0, message: "Trình duyệt này chưa có UDID nào được gửi khi chưa đăng nhập."},
      {headers: accountHeaders});
  try {
    const result = await claimBrowserDevices(
      createAccountDbClient(cfg), credentials, resolved.user.id);
    return applyCookieUpdate(
      NextResponse.json({ok: true, claimed: result.total, detail: result,
        message: result.total > 0
          ? "Đã nhận thiết bị của trình duyệt này vào tài khoản của bạn."
          : "Không có thiết bị chưa có chủ nào khớp với trình duyệt này."},
        {headers: accountHeaders}),
      resolved.cookieUpdate);
  } catch { return accountUnavailable(); }
}
