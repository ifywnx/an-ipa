import {NextRequest, NextResponse} from "next/server";
import {customerConfig, customerFromRequest} from "@/modules/auth/customer-server";
import {createAccountDbClient} from "@/modules/accounts/server";
import {openDeletionRequest, requestUdidDataDeletion} from "@/modules/accounts/ownership";
import {sameOrigin} from "@/modules/auth/session";
import {accountHeaders, accountReject, accountUnavailable, applyCookieUpdate} from "@/modules/accounts/route-helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The account's open UDID-data deletion request, if one exists. */
export async function GET(request: NextRequest) {
  const cfg = customerConfig();
  if (!cfg) return accountUnavailable();
  const resolved = await customerFromRequest(request);
  if (!resolved) return accountReject(401, "AUTH_REQUIRED", "Hãy đăng nhập để xem yêu cầu xóa dữ liệu.");
  try {
    const pending = await openDeletionRequest(createAccountDbClient(cfg), resolved.user.id);
    return applyCookieUpdate(
      NextResponse.json({ok: true, pending}, {headers: accountHeaders}),
      resolved.cookieUpdate);
  } catch { return accountUnavailable(); }
}

/**
 * Raise the deletion flag promised by the draft privacy policy: the
 * operator deletes the account's UDID records and confirms within 30 days.
 * This endpoint only records the request — it does not delete anything
 * itself, so an accidental click cannot destroy install eligibility.
 */
export async function POST(request: NextRequest) {
  const cfg = customerConfig();
  if (!cfg) return accountUnavailable();
  if (!sameOrigin(request.headers.get("origin"), cfg.origin))
    return accountReject(403, "BAD_ORIGIN", "Yêu cầu không hợp lệ.");
  const resolved = await customerFromRequest(request);
  if (!resolved) return accountReject(401, "AUTH_REQUIRED", "Hãy đăng nhập trước khi yêu cầu xóa dữ liệu.");
  try {
    const requestId = await requestUdidDataDeletion(createAccountDbClient(cfg), resolved.user.id);
    if (!requestId) return accountUnavailable();
    return applyCookieUpdate(
      NextResponse.json({ok: true, requestId,
        message: "Đã ghi nhận yêu cầu xóa dữ liệu UDID. Cửa hàng xử lý trong vòng 30 ngày theo chính sách bảo mật."},
        {headers: accountHeaders}),
      resolved.cookieUpdate);
  } catch { return accountUnavailable(); }
}
