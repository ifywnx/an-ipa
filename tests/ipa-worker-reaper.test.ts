import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../supabase/migrations/20261103012000_reap_stale_ipa_scan_leases.sql",import.meta.url),"utf8");
test("service-only reaper rejects dead leases and expired intakes without publishing",()=>{
 assert.match(sql,/revoke all on function public\.reap_expired_ipa_scans\(\) from public,anon,authenticated/);
 assert.match(sql,/grant execute on function public\.reap_expired_ipa_scans\(\) to service_role/);
 assert.match(sql,/i\.scan_attempts>=3/);
 assert.match(sql,/i\.expires_at<=now\(\)/);
 assert.match(sql,/install_eligible=false/);
 assert.match(sql,/signature_trusted=false/);
});
