import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(new URL(`../src/app/api/enrollment/${path}`, import.meta.url), "utf8");
const profile = read("profile/route.ts");
const callback = read("profile-callback/route.ts");
const start = read("start/route.ts");
const status = read("status/route.ts");

test("self-profile endpoints return the standard unavailable response when the mode is off", () => {
  for (const source of [profile, callback]) {
    assert.match(source, /getSelfProfileConfig\(\)/);
    assert.match(source, /if \(!config\) return unavailable\(\)/);
  }
});

test("profile download is bound to a pending, unexpired challenge row", () => {
  assert.match(profile, /challenge_hash=eq\." \+ tokenHash\(challenge\)/);
  assert.match(profile, /row\.status !== "pending"/);
  assert.match(profile, /CHALLENGE_EXPIRED/);
  assert.match(profile, /application\/x-apple-aspen-config/);
  assert.match(profile, /buildProfileServiceMobileconfig/);
  // Signing configured but failing must fail closed, not downgrade silently.
  assert.match(profile, /PROFILE_SIGNING_UNAVAILABLE/);
});

test("device callback completes via the self-report RPC only and records pending intake", () => {
  assert.match(callback, /rpc\/complete_guest_enrollment_self_report/);
  assert.match(callback, /rpc\/submit_self_profile_udid_request/);
  // The provider-verified completion RPC must never be reachable from here.
  assert.doesNotMatch(callback, /rpc\/complete_guest_enrollment"/);
  assert.doesNotMatch(callback, /verifyProviderAttestation/);
  assert.match(callback, /MAX_DEVICE_RESPONSE_BYTES/);
  assert.match(callback, /DEVICE_RESPONSE_UNREADABLE/);
  assert.match(callback, /CHALLENGE_INVALID_EXPIRED_OR_USED/);
});

test("device callback redirects only to the store's own /udid page", () => {
  assert.match(callback, /status: 301/);
  assert.match(callback, /config\.appOrigin \+ "\/udid"/);
  assert.doesNotMatch(callback, /searchParams\.get\("return_to"\)|headers\.get\("referer"\)/i);
});

test("start keeps provider precedence and offers the self profile URL only as fallback", () => {
  assert.match(start, /const provider = getEnrollmentConfig\(\)/);
  assert.match(start, /provider \? null : getSelfProfileConfig\(\)/);
  assert.match(start, /mode: "provider" \| "self_profile"|mode = "provider"|"self_profile"/);
  assert.match(start, /\/api\/enrollment\/profile\?challenge=/);
  assert.match(start, /rpc\/create_guest_enrollment/);
});

test("status surfaces device_reported honestly and never as verified", () => {
  assert.match(status, /row\.status==="device_reported"/);
  assert.match(status, /status:"device_reported"/);
  assert.match(status, /đang chờ xác minh/);
  assert.match(status, /getSelfProfileConfig\(\)/);
});
