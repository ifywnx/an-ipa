import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../supabase/migrations/20261102231052_admin_ipa_intake_registry_quota.sql",import.meta.url),"utf8");
const route=readFileSync(new URL("../src/app/api/admin/uploads/prepare/route.ts",import.meta.url),"utf8");
const list=readFileSync(new URL("../src/app/api/admin/uploads/intakes/route.ts",import.meta.url),"utf8");
test("registry is RLS protected, service-owned and can never grant installation",()=>{
 assert.match(sql,/enable row level security/);
 assert.match(sql,/revoke all on public\.ipa_upload_intakes from public,anon,authenticated/);
 assert.match(sql,/grant select on public\.ipa_upload_intakes to authenticated/);
 assert.doesNotMatch(sql,/grant\s+(?:insert|update|delete)\s+on public\.ipa_upload_intakes to authenticated/);
 assert.match(sql,/install_eligible boolean not null default false check\(install_eligible = false\)/);
 assert.match(sql,/signature_trusted boolean not null default false check\(signature_trusted = false\)/);
 assert.match(sql,/security definer set search_path = ''/);
 assert.match(sql,/private\.reserve_ipa_intake/);
 assert.match(sql,/security invoker set search_path = ''/);
 assert.match(sql,/revoke all on function public\.reserve_ipa_intake\(text,bigint\) from public,anon/);
});
test("atomic reservations enforce actor, file size and quotas",()=>{
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/p_expected_bytes>104857600/);
 assert.match(sql,/hourly_count>=5/);
 assert.match(sql,/active_count>=3/);
 assert.match(sql,/daily_bytes\+p_expected_bytes>524288000/);
 assert.match(sql,/email_confirmed_at is not null/);
 assert.match(sql,/role='admin'/);
});
test("real signed URL waits for DB receipt and scanner readiness",()=>{
 assert.match(route,/R2_SCANNER_READY!=="true"/);
 assert.match(route,/R2_PRIVATE_WAF_READY!=="true"/);
 assert.match(route,/rpc\/reserve_ipa_intake/);
 assert.match(route,/grant\.objectKey!==intake\.object_key/);
 assert.match(route,/presignPrivateIpaPut\(r2,size,new Date\(\),intake.id\)/);
 assert.doesNotMatch(route,/SUPABASE_SECRET_KEY/);
});
test("Admin list uses user JWT and bounded RLS-filtered result",()=>{
 assert.match(list,/verifiedAdmin/);
 assert.match(list,/Authorization:"Bearer "\+session.accessToken/);
 assert.match(list,/requested_by","eq\."\+admin.id/);
 assert.match(list,/limit","20"/);
 assert.doesNotMatch(list,/SUPABASE_SECRET_KEY/);
});
