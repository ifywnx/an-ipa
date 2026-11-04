import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql = readFileSync(new URL("../supabase/migrations/20261105140000_customer_accounts.sql", import.meta.url), "utf8");

function functionBody(signature: string): string {
  const start = sql.indexOf(`create function public.${signature}`);
  assert.ok(start >= 0, signature);
  const end = sql.indexOf("end $$;", start);
  assert.ok(end > start, signature);
  return sql.slice(start, end);
}
const RPCS = [
  "attach_manual_udid_request_owner(uuid,uuid)",
  "attach_guest_enrollment_owner(text,uuid)",
  "claim_manual_udid_requests(text,uuid)",
  "claim_guest_enrollment_owner(text,uuid)",
  "claim_self_profile_udid_requests(text,uuid)",
  "link_self_profile_request_to_enrollment(text)",
  "request_udid_data_deletion(uuid)",
];

test("migration is explicitly not yet applied and links owners on both intake tables", () => {
  assert.match(sql, /NOT YET APPLIED/);
  assert.match(sql, /alter table public\.manual_udid_requests\s+add column user_id uuid null references auth\.users\(id\) on delete set null/);
  assert.match(sql, /alter table public\.guest_enrollments\s+add column user_id uuid null references auth\.users\(id\) on delete set null/);
});

test("every account RPC is service-role only", () => {
  for (const sig of RPCS) {
    const name = sig.slice(0, sig.indexOf("("));
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\(`), name);
    assert.match(sql, new RegExp(`grant execute on function public\\.${sig.replace(/[()]/g, "\\$&")} to service_role`), name);
  }
});

test("claims require possession of the browser credential and an unowned row", () => {
  for (const name of [
    "claim_manual_udid_requests", "claim_guest_enrollment_owner", "claim_self_profile_udid_requests",
  ]) {
    const body = functionBody(name);
    assert.match(body, /user_id is null/, name + " never moves an owned row");
    assert.match(body, /!~ '\^\[a-f0-9\]\{64\}\$'/, name + " validates the credential hash");
  }
  assert.match(functionBody("claim_manual_udid_requests"), /request_token_hash=p_request_token_hash/);
  const selfProfile = functionBody("claim_self_profile_udid_requests");
  assert.match(selfProfile, /m\.udid_hmac=g\.udid_lookup_hmac/);
  assert.match(selfProfile, /m\.source='self_profile'/);
  assert.match(selfProfile, /g\.browser_token_hash=p_browser_hash/);
  // No claim path is keyed by a UDID value anywhere in the migration.
  assert.doesNotMatch(sql, /claim[^\n]*udid[^_\n]*\)\s*returns/i);
  assert.doesNotMatch(sql, /where[^\n]*udid_ciphertext\s*=/);
});

test("the self-profile link reads the owner from the session row, never from a parameter", () => {
  const body = functionBody("link_self_profile_request_to_enrollment");
  assert.doesNotMatch(body, /p_user_id/);
  assert.match(body, /set user_id=g\.user_id/);
  assert.match(body, /g\.user_id is not null/);
  assert.match(body, /m\.user_id is null/);
});

test("ownership writes never touch status or verification fields", () => {
  assert.doesNotMatch(sql, /update public\.manual_udid_requests[^;]*set status/);
  assert.doesNotMatch(sql, /update public\.guest_enrollments[^;]*set status/);
  assert.doesNotMatch(sql, /verified_at\s*=/);
  for (const m of sql.matchAll(/update public\.(manual_udid_requests|guest_enrollments)[^;]*?set ([^f]+?)(\n|where)/g)) {
    assert.match(m[2], /user_id/, "updates only assign user_id: " + m[0].slice(0, 60));
  }
});

test("authenticated read-own access is column-limited and excludes secrets", () => {
  const grant = sql.slice(sql.indexOf("grant select ("), sql.indexOf("to authenticated;"));
  assert.ok(grant.length > 0);
  for (const forbidden of ["udid_ciphertext", "udid_hmac", "request_token_hash", "ip_hmac"])
    assert.ok(!grant.includes(forbidden), "grant must not expose " + forbidden);
  assert.match(sql, /create policy customer_read_own_udid_requests on public\.manual_udid_requests\s+for select to authenticated\s+using \(user_id is not null and user_id = \(select auth\.uid\(\)\)\)/);
});

test("deletion requests are service-role only with one open request per user", () => {
  assert.match(sql, /create table public\.customer_deletion_requests/);
  assert.match(sql, /alter table public\.customer_deletion_requests enable row level security/);
  assert.match(sql, /revoke all on public\.customer_deletion_requests from public, anon, authenticated/);
  assert.match(sql, /create unique index customer_deletion_one_open_per_user\s+on public\.customer_deletion_requests\(user_id\) where status='pending'/);
  const body = functionBody("request_udid_data_deletion");
  assert.match(body, /status='pending'/);
});
