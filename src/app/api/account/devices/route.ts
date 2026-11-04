import {NextRequest, NextResponse} from "next/server";
import {customerConfig, customerFromRequest} from "@/modules/auth/customer-server";
import {createAccountDbClient} from "@/modules/accounts/server";
import {listAccountDevices} from "@/modules/accounts/ownership";
import {accountHeaders, accountReject, accountUnavailable, applyCookieUpdate} from "@/modules/accounts/route-helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every UDID intake record owned by the signed-in account (manual form and
 *  self-profile alike), newest first. Unauthenticated requests are refused;
 *  the query is scoped by the server-verified user id only. */
export async function GET(request: NextRequest) {
  const cfg = customerConfig();
  if (!cfg) return accountUnavailable();
  const resolved = await customerFromRequest(request);
  if (!resolved) return accountReject(401, "AUTH_REQUIRED", "Hãy đăng nhập để xem thiết bị của tài khoản.");
  try {
    const devices = await listAccountDevices(createAccountDbClient(cfg), resolved.user.id);
    return applyCookieUpdate(
      NextResponse.json({ok: true, devices}, {headers: accountHeaders}),
      resolved.cookieUpdate);
  } catch { return accountUnavailable(); }
}
