import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql=readFileSync(new URL("../supabase/migrations/20261103000100_phase2_core.sql", import.meta.url), "utf8");
test("baseline migration explicitly enables RLS on every table", () => {
  for(const table of ["profiles","roles","apps","app_versions","ipa_assets","devices","audit_logs"]) {
    assert.match(sql, new RegExp("alter table public\\."+table+" enable row level security;", "i"));
  }
});
test("migration has public select only on published catalog",()=>{
  assert.match(sql,/using \(status = 'published'\)/);
  assert.match(sql,/grant select \(slug,title,summary,category,developer_name,status,created_at\)/);
  assert.doesNotMatch(sql,/create policy.+for (insert|update|delete)/i);
});
