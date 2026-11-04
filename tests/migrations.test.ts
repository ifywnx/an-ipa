import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const oldSql=readFileSync(new URL("../supabase/migrations/20261103000100_phase2_core.sql", import.meta.url), "utf8");
const hardened=readFileSync(new URL("../supabase/migrations/20261103000200_harden_phase2_access.sql", import.meta.url), "utf8");
test("obsolete conflicting schema draft cannot create tables", () => {
  assert.doesNotMatch(oldSql, /create table\s+public\./i);
});
test("hardening revokes sensitive mutation privileges", () => {
  for(const table of ["apps","app_versions","distribution_channels","devices","ipa_assets"])
    assert.match(hardened, new RegExp("\\b"+table+"\\b"));
  assert.match(hardened, /revoke insert, update, delete on public\.apps/);
  assert.match(hardened, /drop policy if exists upload_quarantine/);
  assert.match(hardened, /grant select \(id, slug, name, developer, description, category, icon_url, published, created_at\)/);
});
