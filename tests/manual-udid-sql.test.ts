import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const migration=readFileSync(new URL("../supabase/migrations/20261103001000_guest_manual_udid_pending_requests.sql",import.meta.url),"utf8");
test("manual UDID table has RLS, private grants, encrypted fields and request quotas",()=>{
 assert.match(migration,/alter table public\.manual_udid_requests enable row level security/);
 assert.match(migration,/revoke all on public\.manual_udid_requests from public,anon,authenticated/);
 assert.match(migration,/udid_ciphertext text not null/);
 assert.match(migration,/pg_advisory_xact_lock/);
 assert.match(migration,/status text not null default 'pending_unverified'/);
 assert.match(migration,/grant execute on function public\.submit_manual_udid_request.*service_role/);
});
