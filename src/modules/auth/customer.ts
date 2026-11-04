import {createCipheriv, createDecipheriv, randomBytes} from "node:crypto";
import {readKey} from "./session";

/**
 * Customer accounts (buyers), built on the same Supabase Auth project as
 * Admin but strictly separated from it:
 * - a different cookie (__Host-an-customer), a different sealing key
 *   (CUSTOMER_SESSION_KEY_B64) and NO role lookup anywhere in this module.
 *   A customer session can therefore never satisfy the Admin checks, which
 *   require their own cookie, their own key and a fresh roles-table lookup.
 * - Identity is revalidated against Supabase Auth (/auth/v1/user) on every
 *   read, exactly like Admin. The sealed cookie only carries the Supabase
 *   token pair so an expired access token can be rotated by route handlers.
 * - Having an account is NOT device trust evidence: it never feeds OTA
 *   eligibility. It only links UDID intake records to their owner.
 *
 * This module is intentionally free of `server-only` and next/headers so the
 * pure logic (config gate, sealing, token resolution) is unit-testable with
 * a fake transport, following the self-profile.ts precedent.
 */
export const CUSTOMER_COOKIE = "__Host-an-customer";
/** Absolute cap for a customer login, however often the token rotates. */
export const MAX_CUSTOMER_SESSION_SECONDS = 30 * 24 * 3600;
/** Rotate the access token when less than this remains. */
const REFRESH_SKEW_MS = 60_000;
const MAX_TOKEN_LENGTH = 4096;

export interface CustomerAccountsConfig {
  origin: string;
  supabaseUrl: string;
  publishableKey: string;
  serviceKey: string;
  sessionKey: Buffer;
}

export function parseCustomerAccountsConfig(
  env: Record<string, string | undefined>,
): CustomerAccountsConfig | null {
  if (env.CUSTOMER_ACCOUNTS_ENABLED !== "true") return null;
  if (!(env.CUSTOMER_AUTH_WAF_READY === "true"
    || (env.VERCEL_ENV === "preview" && env.CUSTOMER_AUTH_PREVIEW_PROTECTED === "true")))
    return null;
  if (!env.APP_ORIGIN || !env.NEXT_PUBLIC_SUPABASE_URL
    || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_SECRET_KEY
    || !env.CUSTOMER_SESSION_KEY_B64) return null;
  try {
    const origin = new URL(env.APP_ORIGIN), db = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    if (origin.origin !== env.APP_ORIGIN || db.origin !== env.NEXT_PUBLIC_SUPABASE_URL
      || origin.protocol !== "https:" || db.protocol !== "https:"
      || origin.username || origin.password || db.username || db.password) return null;
    return {
      origin: origin.origin, supabaseUrl: db.origin,
      publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      serviceKey: env.SUPABASE_SECRET_KEY,
      sessionKey: readKey(env.CUSTOMER_SESSION_KEY_B64),
    };
  } catch { return null; }
}

export function customerAccountsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return parseCustomerAccountsConfig(env) !== null;
}

export interface CustomerUser { id: string; email: string }
export interface CustomerTokens { accessToken: string; refreshToken: string; expiresAt: number }
export interface CustomerSession extends CustomerTokens { issuedAt: number }

type AuthUserShape = {id?: unknown; email?: unknown; email_confirmed_at?: unknown; banned_until?: unknown};
export function validCustomerUser(value: unknown): value is {id: string; email: string; email_confirmed_at: string} {
  if (!value || typeof value !== "object") return false;
  const v = value as AuthUserShape;
  return typeof v.id === "string" && /^[0-9a-f-]{36}$/.test(v.id)
    && typeof v.email === "string" && !!v.email
    && typeof v.email_confirmed_at === "string" && !!v.email_confirmed_at
    && !(typeof v.banned_until === "string" && Date.parse(v.banned_until) > Date.now());
}

export function sealCustomerSession(session: CustomerSession, key: Buffer): string {
  if (!Number.isFinite(session.expiresAt) || !Number.isFinite(session.issuedAt)
    || !session.accessToken || session.accessToken.length > MAX_TOKEN_LENGTH
    || !session.refreshToken || session.refreshToken.length > MAX_TOKEN_LENGTH
    || session.expiresAt - session.issuedAt > MAX_CUSTOMER_SESSION_SECONDS * 1000)
    throw new Error("Invalid customer session");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(v => v.toString("base64url")).join(".");
}

export function unsealCustomerSession(value: string, key: Buffer, now = Date.now()): CustomerSession | null {
  try {
    if (!value || value.length > 10000) return null;
    const parts = value.split(".");
    if (parts.length !== 3) return null;
    const [iv, tag, ciphertext] = parts.map(p => Buffer.from(p, "base64url"));
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const session: unknown = JSON.parse(plain);
    if (!session || typeof session !== "object") return null;
    const d = session as Record<string, unknown>;
    if (typeof d.accessToken !== "string" || d.accessToken.length < 20 || d.accessToken.length > MAX_TOKEN_LENGTH
      || typeof d.refreshToken !== "string" || d.refreshToken.length < 10 || d.refreshToken.length > MAX_TOKEN_LENGTH
      || typeof d.issuedAt !== "number" || typeof d.expiresAt !== "number"
      || d.issuedAt > now + 60_000
      || now - d.issuedAt > MAX_CUSTOMER_SESSION_SECONDS * 1000
      || d.expiresAt > d.issuedAt + MAX_CUSTOMER_SESSION_SECONDS * 1000)
      return null;
    return {
      accessToken: d.accessToken, refreshToken: d.refreshToken,
      issuedAt: d.issuedAt, expiresAt: d.expiresAt,
    };
  } catch { return null; }
}

async function safeJson(response: Response): Promise<unknown> {
  if (!response.ok) return null;
  const size = response.headers.get("content-length");
  if (size && Number(size) > 16384) return null;
  try { return await response.json() as unknown; } catch { return null; }
}

type TokenResponse = {access_token?: unknown; refresh_token?: unknown; expires_in?: unknown};
function parseTokenResponse(json: unknown, now: number): CustomerTokens | null {
  if (!json || typeof json !== "object") return null;
  const t = json as TokenResponse;
  if (typeof t.access_token !== "string" || typeof t.refresh_token !== "string"
    || typeof t.expires_in !== "number" || t.expires_in < 120
    || t.access_token.length > MAX_TOKEN_LENGTH || t.refresh_token.length > MAX_TOKEN_LENGTH)
    return null;
  return {
    accessToken: t.access_token, refreshToken: t.refresh_token,
    expiresAt: now + Math.floor(t.expires_in) * 1000,
  };
}

/** Fresh identity check against Supabase Auth. Deliberately NO roles query:
 *  every confirmed, unbanned account is a customer; roles only gate Admin. */
export async function fetchCustomerUser(
  accessToken: string, cfg: CustomerAccountsConfig, transport: typeof fetch = fetch,
): Promise<CustomerUser | null> {
  if (!accessToken || accessToken.length > MAX_TOKEN_LENGTH) return null;
  try {
    const response = await transport(cfg.supabaseUrl + "/auth/v1/user", {
      method: "GET",
      headers: {apikey: cfg.publishableKey, Authorization: "Bearer " + accessToken},
      signal: AbortSignal.timeout(7000), cache: "no-store",
    });
    const u = await safeJson(response);
    if (!validCustomerUser(u)) return null;
    return {id: u.id, email: u.email};
  } catch { return null; }
}

export async function refreshCustomerTokens(
  refreshToken: string, cfg: CustomerAccountsConfig,
  transport: typeof fetch = fetch, now = Date.now(),
): Promise<CustomerTokens | null> {
  if (!refreshToken || refreshToken.length > MAX_TOKEN_LENGTH) return null;
  try {
    const response = await transport(cfg.supabaseUrl + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: {apikey: cfg.publishableKey, "Content-Type": "application/json"},
      body: JSON.stringify({refresh_token: refreshToken}),
      signal: AbortSignal.timeout(8000), cache: "no-store",
    });
    if (!response.ok) return null;
    return parseTokenResponse(await response.json() as unknown, now);
  } catch { return null; }
}

export interface ResolvedCustomer {
  user: CustomerUser;
  /** Set when the access token was rotated; the caller (a route handler)
   *  must re-seal and re-set the cookie, otherwise the old pair is replayed
   *  and Supabase may revoke the session family. */
  rotated: CustomerSession | null;
}

/**
 * Resolve a sealed cookie value to a verified customer. Access tokens are
 * verified while fresh; an expired access token is exchanged once via the
 * sealed refresh token. Anything else resolves to null (logged out).
 */
export async function resolveCustomerSession(
  sealed: string | undefined, cfg: CustomerAccountsConfig,
  transport: typeof fetch = fetch, now = Date.now(),
): Promise<ResolvedCustomer | null> {
  if (!sealed) return null;
  const session = unsealCustomerSession(sealed, cfg.sessionKey, now);
  if (!session) return null;
  if (session.expiresAt > now + REFRESH_SKEW_MS) {
    const user = await fetchCustomerUser(session.accessToken, cfg, transport);
    return user ? {user, rotated: null} : null;
  }
  const tokens = await refreshCustomerTokens(session.refreshToken, cfg, transport, now);
  if (!tokens) return null;
  const user = await fetchCustomerUser(tokens.accessToken, cfg, transport);
  if (!user) return null;
  return {user, rotated: {...tokens, issuedAt: session.issuedAt}};
}

/** Landing page for email confirmation, magic links and OAuth returns. */
export function customerAuthCallbackUrl(cfg: CustomerAccountsConfig): string {
  return cfg.origin + "/auth/callback";
}

/** Google sign-in is a plain Supabase authorize redirect; the provider and
 *  the redirect URL must be enabled in the Supabase Dashboard by the owner
 *  (see docs/CUSTOMER_ACCOUNTS.md) — this code only builds the entry URL. */
export function googleAuthorizeUrl(cfg: CustomerAccountsConfig): string {
  const url = new URL("/auth/v1/authorize", cfg.supabaseUrl);
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", customerAuthCallbackUrl(cfg));
  return url.toString();
}

export function tokensFromGrantResponse(json: unknown, now = Date.now()): CustomerTokens | null {
  return parseTokenResponse(json, now);
}
