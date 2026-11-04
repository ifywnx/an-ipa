import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20261105090000_install_grants_and_verifier_attestations.sql",
    import.meta.url,
  ),
  "utf8",
);

test("migration is explicitly not yet applied and only adds new tables", () => {
  assert.match(sql, /NOT YET APPLIED/);
  assert.match(sql, /begin;/);
  assert.match(sql, /commit;/);
  assert.doesNotMatch(sql, /alter table public\.(devices|app_versions|apps|ipa_assets)/i);
  assert.doesNotMatch(sql, /drop table/i);
});

test("install_grants stores hashes only, with the 10-minute window enforced", () => {
  assert.match(sql, /create table public\.install_grants/);
  assert.match(sql, /token_hash text not null unique check\(token_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.match(sql, /expires_at <= issued_at \+ interval '10 minutes'/);
  assert.match(sql, /status in \('active','revoked'\)/);
  assert.doesNotMatch(sql, /\btoken text\b/);
});

test("both tables are service-role only behind RLS", () => {
  for (const table of ["install_grants", "verifier_attestations"]) {
    assert.match(sql, new RegExp("alter table public\\." + table + " enable row level security"));
    assert.match(sql, new RegExp("revoke all on public\\." + table + " from public, anon, authenticated"));
    assert.match(sql, new RegExp("grant [^;]+ on public\\." + table + " to service_role"));
  }
});

test("verifier_attestations binds evidence to the exact artifact hash", () => {
  assert.match(sql, /create table public\.verifier_attestations/);
  assert.match(sql, /asset_id uuid not null/);
  assert.match(sql, /artifact_sha256 text not null check\(artifact_sha256 ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.match(sql, /verifier_attestations_asset_idx/);
});
