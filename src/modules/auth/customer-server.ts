import "server-only";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {
  CUSTOMER_COOKIE, MAX_CUSTOMER_SESSION_SECONDS, parseCustomerAccountsConfig,
  resolveCustomerSession, sealCustomerSession,
  type CustomerAccountsConfig, type CustomerUser, type ResolvedCustomer,
} from "./customer";

export type {CustomerAccountsConfig, CustomerUser};
export {CUSTOMER_COOKIE};

export function customerConfig(): CustomerAccountsConfig | null {
  return parseCustomerAccountsConfig(process.env);
}

export interface CustomerCookieUpdate {
  value: string;
  maxAgeSeconds: number;
}

/** When a session was rotated, routes must persist the new sealed cookie. */
export function rotationUpdate(
  resolved: ResolvedCustomer, cfg: CustomerAccountsConfig, now = Date.now(),
): CustomerCookieUpdate | null {
  if (!resolved.rotated) return null;
  const remaining = Math.floor((resolved.rotated.issuedAt
    + MAX_CUSTOMER_SESSION_SECONDS * 1000 - now) / 1000);
  if (remaining < 60) return null;
  return {value: sealCustomerSession(resolved.rotated, cfg.sessionKey), maxAgeSeconds: remaining};
}

export interface RequestCustomer {
  user: CustomerUser;
  cookieUpdate: CustomerCookieUpdate | null;
}

/** Full session resolution for API route handlers (supports rotation). */
export async function customerFromRequest(
  request: {cookies: {get(name: string): {value: string} | undefined}},
): Promise<RequestCustomer | null> {
  const cfg = customerConfig();
  if (!cfg) return null;
  const sealed = request.cookies.get(CUSTOMER_COOKIE)?.value;
  const resolved = await resolveCustomerSession(sealed, cfg);
  if (!resolved) return null;
  return {user: resolved.user, cookieUpdate: rotationUpdate(resolved, cfg)};
}

/**
 * Read-only resolution for server components, which cannot set cookies:
 * succeeds only while the access token itself is still fresh. Client-driven
 * account pages call /api/account/session to rotate when needed.
 */
export async function customerFromSession(): Promise<CustomerUser | null> {
  const cfg = customerConfig();
  if (!cfg) return null;
  const sealed = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  const resolved = await resolveCustomerSession(sealed, cfg);
  return resolved && !resolved.rotated ? resolved.user : null;
}

export async function requireCustomer() {
  const account = await customerFromSession();
  if (!account) redirect("/login?reason=account");
  return account;
}
