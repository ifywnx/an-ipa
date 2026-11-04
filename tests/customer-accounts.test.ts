import {test} from "node:test";
import assert from "node:assert/strict";
import {
  parseCustomerAccountsConfig, sealCustomerSession, unsealCustomerSession,
  validCustomerUser, fetchCustomerUser, resolveCustomerSession, googleAuthorizeUrl,
  CUSTOMER_COOKIE, MAX_CUSTOMER_SESSION_SECONDS, type CustomerSession,
} from "../src/modules/auth/customer";
import {ADMIN_COOKIE} from "../src/modules/auth/session";
import {unsealAdminSession} from "../src/modules/auth/session";

const KEY = Buffer.alloc(32, 7).toString("base64");
const env = {
  CUSTOMER_ACCOUNTS_ENABLED: "true",
  CUSTOMER_AUTH_WAF_READY: "true",
  APP_ORIGIN: "https://store.test",
  NEXT_PUBLIC_SUPABASE_URL: "https://db.test",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  CUSTOMER_SESSION_KEY_B64: KEY,
};
const cfg = parseCustomerAccountsConfig(env);
assert.ok(cfg);
const USER = {
  id: "11111111-2222-3333-4444-555555555555",
  email: "khach@vi-du.com",
  email_confirmed_at: "2026-11-05T00:00:00Z",
};

function session(patch: Partial<CustomerSession> = {}): CustomerSession {
  const now = Date.now();
  return {
    accessToken: "a".repeat(60), refreshToken: "r".repeat(40),
    issuedAt: now, expiresAt: now + 3600_000, ...patch,
  };
}

test("accounts stay off unless flag, WAF gate and all secrets are present", () => {
  assert.ok(parseCustomerAccountsConfig(env));
  assert.equal(parseCustomerAccountsConfig({...env, CUSTOMER_ACCOUNTS_ENABLED: "false"}), null);
  assert.equal(parseCustomerAccountsConfig({...env, CUSTOMER_ACCOUNTS_ENABLED: "1"}), null);
  assert.equal(parseCustomerAccountsConfig({...env, CUSTOMER_AUTH_WAF_READY: "false"}), null);
  assert.equal(parseCustomerAccountsConfig({...env, CUSTOMER_SESSION_KEY_B64: ""}), null);
  assert.equal(parseCustomerAccountsConfig({...env, SUPABASE_SECRET_KEY: ""}), null);
  assert.equal(parseCustomerAccountsConfig({...env, APP_ORIGIN: "http://store.test"}), null);
  // The Vercel-preview override mirrors the Admin pattern only.
  assert.ok(parseCustomerAccountsConfig({
    ...env, CUSTOMER_AUTH_WAF_READY: "false",
    VERCEL_ENV: "preview", CUSTOMER_AUTH_PREVIEW_PROTECTED: "true",
  }));
  assert.equal(parseCustomerAccountsConfig({
    ...env, CUSTOMER_AUTH_WAF_READY: "false",
    VERCEL_ENV: "production", CUSTOMER_AUTH_PREVIEW_PROTECTED: "true",
  }), null);
});

test("customer cookie and key are fully separate from the admin session", () => {
  assert.equal(CUSTOMER_COOKIE, "__Host-an-customer");
  assert.notEqual(CUSTOMER_COOKIE, ADMIN_COOKIE);
  const sealed = sealCustomerSession(session(), cfg.sessionKey);
  assert.ok(!sealed.includes("a".repeat(60)));
  // The admin unsealer (different key + format rules) cannot open it.
  assert.equal(unsealAdminSession(sealed, Buffer.alloc(32, 99)), null);
  assert.deepEqual(unsealCustomerSession(sealed, cfg.sessionKey)?.accessToken, "a".repeat(60));
});

test("customer sessions seal, expire and reject tampering", () => {
  const now = Date.now();
  const sealed = sealCustomerSession(session(), cfg.sessionKey);
  assert.equal(unsealCustomerSession(sealed.slice(0, -6) + "tamper", cfg.sessionKey, now), null);
  assert.equal(unsealCustomerSession(sealed, Buffer.alloc(32, 8), now), null);
  // Beyond the 30-day absolute cap the session is dead even if tokens look fine.
  const old = sealCustomerSession(
    session({issuedAt: now - (MAX_CUSTOMER_SESSION_SECONDS + 3600) * 1000,
             expiresAt: now - MAX_CUSTOMER_SESSION_SECONDS * 1000}),
    cfg.sessionKey);
  assert.equal(unsealCustomerSession(old, cfg.sessionKey, now), null);
});

test("only confirmed, unbanned users are customers", () => {
  assert.equal(validCustomerUser(USER), true);
  assert.equal(validCustomerUser({...USER, email_confirmed_at: null}), false);
  assert.equal(validCustomerUser({...USER, banned_until: new Date(Date.now() + 60000).toISOString()}), false);
  assert.equal(validCustomerUser({...USER, id: "not-a-uuid"}), false);
});

function recorder(handler: (url: string) => Response) {
  const calls: string[] = [];
  const transport = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return {calls, transport};
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: {"Content-Type": "application/json"},
});

test("identity check hits only /auth/v1/user — never a roles lookup", async () => {
  const {calls, transport} = recorder(() => json(USER));
  const user = await fetchCustomerUser("token".repeat(10), cfg, transport);
  assert.deepEqual(user, {id: USER.id, email: USER.email});
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/auth\/v1\/user$/);
  assert.ok(!calls.some(c => c.includes("roles")), "customer auth must not consult roles");
});

test("a fresh access token resolves without rotation", async () => {
  const {transport} = recorder(() => json(USER));
  const resolved = await resolveCustomerSession(
    sealCustomerSession(session(), cfg.sessionKey), cfg, transport);
  assert.equal(resolved?.user.email, USER.email);
  assert.equal(resolved?.rotated, null);
});

test("an expired access token rotates once through the refresh token", async () => {
  const now = Date.now();
  const stale = session({expiresAt: now - 1000});
  const {calls, transport} = recorder((url) => {
    if (url.includes("grant_type=refresh_token"))
      return json({access_token: "n".repeat(60), refresh_token: "s".repeat(40), expires_in: 3600});
    return json(USER);
  });
  const resolved = await resolveCustomerSession(
    sealCustomerSession(stale, cfg.sessionKey), cfg, transport, now);
  assert.equal(resolved?.user.email, USER.email);
  assert.equal(resolved?.rotated?.accessToken, "n".repeat(60));
  assert.equal(resolved?.rotated?.issuedAt, stale.issuedAt, "rotation keeps the absolute session start");
  assert.ok(calls.some(c => c.includes("grant_type=refresh_token")));
});

test("failed refresh or banned user resolves to logged out", async () => {
  const now = Date.now();
  const stale = sealCustomerSession(session({expiresAt: now - 1000}), cfg.sessionKey);
  const failRefresh = recorder(() => json({error: "invalid_grant"}, 400));
  assert.equal(await resolveCustomerSession(stale, cfg, failRefresh.transport, now), null);
  const banned = recorder((url) => url.includes("grant_type=refresh_token")
    ? json({access_token: "n".repeat(60), refresh_token: "s".repeat(40), expires_in: 3600})
    : json({...USER, banned_until: new Date(now + 60000).toISOString()}));
  assert.equal(await resolveCustomerSession(stale, cfg, banned.transport, now), null);
  assert.equal(await resolveCustomerSession(undefined, cfg, banned.transport, now), null);
  assert.equal(await resolveCustomerSession("garbage", cfg, banned.transport, now), null);
});

test("google authorize URL points at Supabase with our callback as redirect", () => {
  const url = new URL(googleAuthorizeUrl(cfg));
  assert.equal(url.origin + url.pathname, "https://db.test/auth/v1/authorize");
  assert.equal(url.searchParams.get("provider"), "google");
  assert.equal(url.searchParams.get("redirect_to"), "https://store.test/auth/callback");
});
