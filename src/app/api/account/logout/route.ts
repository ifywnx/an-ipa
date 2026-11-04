import {NextRequest, NextResponse} from "next/server";
import {customerConfig} from "@/modules/auth/customer-server";
import {CUSTOMER_COOKIE, unsealCustomerSession} from "@/modules/auth/customer";
import {sameOrigin} from "@/modules/auth/session";
import {accountHeaders, accountReject, accountUnavailable, clearCustomerCookie} from "@/modules/accounts/route-helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const cfg = customerConfig();
  if (!cfg) return accountUnavailable();
  if (!sameOrigin(request.headers.get("origin"), cfg.origin))
    return accountReject(403, "BAD_ORIGIN", "Yêu cầu không hợp lệ.");
  // Best effort: revoke the Supabase session server-side too. A stale or
  // already-expired token simply makes this a no-op; the cookie is cleared
  // either way.
  const sealed = request.cookies.get(CUSTOMER_COOKIE)?.value;
  const session = sealed ? unsealCustomerSession(sealed, cfg.sessionKey) : null;
  if (session) {
    try {
      await fetch(cfg.supabaseUrl + "/auth/v1/logout", {
        method: "POST",
        headers: {apikey: cfg.publishableKey, Authorization: "Bearer " + session.accessToken},
        signal: AbortSignal.timeout(5000), cache: "no-store",
      });
    } catch { /* cookie clearing below is the guarantee */ }
  }
  return clearCustomerCookie(NextResponse.json({ok: true}, {headers: accountHeaders}));
}
