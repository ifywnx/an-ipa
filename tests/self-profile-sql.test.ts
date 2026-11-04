import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../supabase/migrations/20261105120000_self_profile_enrollment.sql", import.meta.url), "utf8");
const foundation = readFileSync(new URL("../supabase/migrations/20261102211217_guest_enrollment_verified_provider_foundation.sql", import.meta.url), "utf8");

function functionBody(name: string): string {
  const start = sql.indexOf(`create function public.${name}`);
  assert.ok(start >= 0, name);
  const end = sql.indexOf("end $$;", start);
  assert.ok(end > start, name);
  return sql.slice(start, end);
}

test("self-report completion is atomic, one-time and can never produce 'verified'", () => {
  const body = functionBody("complete_guest_enrollment_self_report");
  assert.match(body, /status='pending' and expires_at>now\(\)/);
  assert.match(body, /set status='device_reported'/);
  assert.match(body, /report_source='self_profile'/);
  assert.doesNotMatch(body, /'verified'/);
  assert.match(sql, /grant execute on function public\.complete_guest_enrollment_self_report.*service_role/);
  assert.match(sql, /revoke all on function public\.complete_guest_enrollment_self_report.*from public, anon, authenticated/);
});

test("database constraint keeps device_reported distinct from provider-verified proof", () => {
  assert.match(sql, /status in \('pending','verified','device_reported','rejected'\)/);
  assert.match(sql, /status = 'device_reported' and udid_ciphertext is not null/);
  assert.match(sql, /verified_at is null and provider_reference is null/);
  assert.match(sql, /report_source = 'self_profile' and reported_at is not null/);
  assert.match(sql, /status = 'verified' and udid_ciphertext is not null and udid_lookup_hmac is not null\s+and verified_at is not null and report_source is distinct from 'self_profile'/);
});

test("self-profile intake lands in the same pending_unverified path with its source recorded", () => {
  assert.match(sql, /add column source text not null default 'manual_form'/);
  assert.match(sql, /check \(source in \('manual_form','self_profile'\)\)/);
  const body = functionBody("submit_self_profile_udid_request");
  assert.match(body, /pg_advisory_xact_lock/);
  assert.match(body, /'self_profile'\)/);
  assert.match(sql, /grant execute on function public\.submit_self_profile_udid_request.*service_role/);
  // The pending status itself comes from the untouched manual table default.
  const manual = readFileSync(new URL("../supabase/migrations/20261103001000_guest_manual_udid_pending_requests.sql", import.meta.url), "utf8");
  assert.match(manual, /status text not null default 'pending_unverified'/);
});

test("the verified provider path is not weakened by the self-profile migration", () => {
  assert.doesNotMatch(sql, /complete_guest_enrollment\(/);
  assert.match(foundation, /grant execute on function public\.complete_guest_enrollment.*service_role/);
  assert.match(sql, /drop constraint verified_requires_proof/);
  assert.match(sql, /guest_enrollments_completion_proof/);
});
