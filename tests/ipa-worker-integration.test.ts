import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const migration=readFileSync(new URL("../supabase/migrations/20261103005500_ipa_quarantine_worker_transitions.sql",import.meta.url),"utf8");
const route=readFileSync(new URL("../src/app/api/admin/uploads/complete/route.ts",import.meta.url),"utf8");
const upload=readFileSync(new URL("../src/components/private-ipa-upload.tsx",import.meta.url),"utf8");
test("scanner jobs are service-only, leased and never grant distribution",()=>{
 assert.match(migration,/for update skip locked limit 1/);
 assert.match(migration,/scan_token=gen_random_uuid/);
 assert.match(migration,/scan_lease_until>now/);
 assert.match(migration,/scan_attempts<3/);
 assert.match(migration,/signature_trusted=false,install_eligible=false/);
 assert.match(migration,/revoke all on function public.claim_ipa_scan\(\) from public,anon,authenticated/);
 assert.match(migration,/revoke all on function public.finish_ipa_scan\(uuid,uuid,text,text,jsonb,text\)/);
});
test("upload acknowledgement belongs to verified Admin and is NOT a publication event",()=>{
 assert.match(migration,/i.requested_by=actor/);
 assert.match(migration,/i.state='reserved'/);
 assert.match(route,/verifiedAdmin/);
 assert.match(route,/sameOrigin/);
 assert.match(route,/R2_SCANNER_READY/);
 assert.match(route,/rpc\/ack_ipa_upload/);
 assert.doesNotMatch(route,/SUPABASE_SECRET_KEY/);
 assert.match(upload,/uploads\/complete/);
});
