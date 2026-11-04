import "server-only";
import {NextRequest, NextResponse} from "next/server";
import {sameOrigin} from "../auth/session";
import {
  CUSTOMER_COOKIE, MAX_CUSTOMER_SESSION_SECONDS,
  type CustomerAccountsConfig, type CustomerSession,
} from "../auth/customer";
import type {CustomerCookieUpdate} from "../auth/customer-server";

export const accountHeaders = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"};

export function accountUnavailable() {
  return NextResponse.json(
    {ok: false, error: "CUSTOMER_ACCOUNTS_NOT_CONFIGURED",
     message: "Tài khoản khách hàng chưa được kích hoạt trên website này."},
    {status: 503, headers: accountHeaders});
}

export function accountReject(status: number, error: string, message: string) {
  return NextResponse.json({ok: false, error, message}, {status, headers: accountHeaders});
}

export function checkOrigin(request: NextRequest, cfg: CustomerAccountsConfig): boolean {
  return sameOrigin(request.headers.get("origin"), cfg.origin)
    && !!request.headers.get("content-type")?.startsWith("application/json");
}

export async function readJsonBody(request: NextRequest, maxBytes = 4096): Promise<unknown | null> {
  try {
    if (Number(request.headers.get("content-length") || 0) > maxBytes) return null;
    const text = await request.text();
    if (text.length > maxBytes) return null;
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}

export function parseCredentials(body: unknown): {email: string; password: string} | null {
  if (!body || typeof body !== "object") return null;
  const v = body as Record<string, unknown>;
  if (typeof v.email !== "string" || typeof v.password !== "string"
    || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email) || v.email.length > 254
    || v.password.length < 8 || v.password.length > 256) return null;
  return {email: v.email, password: v.password};
}

export function parseEmail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const email = (body as Record<string, unknown>).email;
  if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    || email.length > 254) return null;
  return email;
}

/** Cookie lifetime is the remaining absolute session window (30 days max),
 *  independent of the shorter Supabase access-token lifetime. */
export function sessionCookieOptions(session: CustomerSession, now = Date.now()) {
  const remaining = Math.floor(
    (session.issuedAt + MAX_CUSTOMER_SESSION_SECONDS * 1000 - now) / 1000);
  return {
    httpOnly: true, secure: true, sameSite: "lax" as const, path: "/",
    maxAge: Math.max(60, remaining),
  };
}

export function applyCookieUpdate(response: NextResponse, update: CustomerCookieUpdate | null) {
  if (update) {
    response.cookies.set(CUSTOMER_COOKIE, update.value, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/",
      maxAge: update.maxAgeSeconds,
    });
  }
  return response;
}

export function clearCustomerCookie(response: NextResponse) {
  response.cookies.set(CUSTOMER_COOKIE, "", {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0,
  });
  return response;
}

/** Best-effort expiry from a JWT payload; identity is always verified
 *  separately against Supabase, this only sizes the cookie/token window. */
export function jwtExpiryMs(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object") return null;
    const exp = (payload as {exp?: unknown}).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch { return null; }
}
