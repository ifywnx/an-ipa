import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read = (rel: string) => readFileSync(new URL("../src/" + rel, import.meta.url), "utf8");
const accountRoute = (name: string) => read(`app/api/account/${name}/route.ts`);

test("every account route is behind the accounts flag and fails closed", () => {
  for (const name of ["login", "register", "logout", "magic-link", "session", "devices", "claim", "deletion-request"]) {
    const source = accountRoute(name);
    assert.match(source, /customerConfig\(\)/, name);
    assert.match(source, /accountUnavailable\(\)/, name);
  }
});

test("unauthenticated account data routes refuse with 401", () => {
  for (const name of ["devices", "claim", "deletion-request"]) {
    const source = accountRoute(name);
    assert.match(source, /customerFromRequest/, name);
    assert.match(source, /accountReject\(401, "AUTH_REQUIRED"/, name);
  }
});

test("the claim route reads no request body and no identifier — cookies only", () => {
  const source = accountRoute("claim");
  assert.doesNotMatch(source, /request\.json\(\)|request\.text\(\)|await request\.body/);
  assert.doesNotMatch(source, /normalizeUdid/);
  assert.match(source, /request\.cookies\.get\(MANUAL_COOKIE\)/);
  assert.match(source, /request\.cookies\.get\(ENROLLMENT_COOKIE\)/);
  assert.match(source, /tokenHash\(manual\)|tokenHash\(enrollment\)/);
});

test("customer auth never consults roles and admin auth never accepts the customer cookie", () => {
  const customerModule = read("modules/auth/customer.ts");
  const customerServer = read("modules/auth/customer-server.ts");
  for (const source of [customerModule, customerServer]) {
    assert.doesNotMatch(source, /rest\/v1\/roles|\broles\b.*role=.admin/);
    assert.doesNotMatch(source, /ADMIN_COOKIE|__Host-an-admin/);
  }
  const adminServer = read("modules/auth/admin-server.ts");
  assert.doesNotMatch(adminServer, /CUSTOMER_COOKIE|__Host-an-customer|customer/i);
  assert.match(adminServer, /role","eq\.admin"|role.*eq\.admin/);
  // Login/register must not grant or check any role either.
  for (const name of ["login", "register"]) {
    assert.doesNotMatch(accountRoute(name), /rest\/v1\/roles|verifiedAdmin|public\.roles/);
  }
});

test("password login verifies the fresh user before sealing any cookie", () => {
  const login = accountRoute("login");
  assert.match(login, /grant_type=password/);
  assert.match(login, /fetchCustomerUser\(tokens\.accessToken, cfg\)/);
  assert.match(login, /sealCustomerSession/);
  const register = accountRoute("register");
  assert.match(register, /auth\/v1\/signup/);
  assert.match(register, /validCustomerUser\(rawUser\)/);
  assert.match(register, /confirmed: false/);
});

test("existing intake flows attach ownership best-effort when signed in", () => {
  const manual = read("app/api/devices/manual/route.ts");
  assert.match(manual, /customerFromRequest\(r\)/);
  assert.match(manual, /attachManualRequest\(createAccountDbClient\(accountCfg\),id,account\.user\.id\)/);
  const start = read("app/api/enrollment/start/route.ts");
  assert.match(start, /attachGuestEnrollment\(/);
  assert.match(start, /tokenHash\(browser\)/);
  const callback = read("app/api/enrollment/profile-callback/route.ts");
  assert.match(callback, /linkSelfProfileRequest\(accountDb, tokenHash\(reported\.challenge\)\)/);
});

test("login and register pages hide the forms while accounts are disabled", () => {
  for (const page of ["app/login/page.tsx", "app/register/page.tsx"]) {
    const source = read(page);
    assert.match(source, /customerConfig\(\)/, page);
    assert.match(source, /chưa được kích hoạt/, page);
    assert.match(source, /CustomerAuthForm/, page);
  }
});
