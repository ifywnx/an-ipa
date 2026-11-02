import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../supabase/migrations/20261103003000_purge_expired_device_intake.sql",import.meta.url),"utf8");
const route=readFileSync(new URL("../src/app/api/internal/retention/route.ts",import.meta.url),"utf8");
test("expired UDID records are purged by service-only function",()=>{
 assert.match(sql,/where expires_at <= now\(\)/g);
 assert.match(sql,/security invoker/);
 assert.match(sql,/revoke all on function public\.purge_expired_device_intake\(\)/);
 assert.match(sql,/to service_role/);
});
test("retention endpoint requires explicit enablement and constant-time bearer",()=>{
 assert.match(route,/MAINTENANCE_ENABLED/);
 assert.match(route,/timingSafeEqual/);
 assert.match(route,/MAINTENANCE_CRON_SECRET/);
 assert.doesNotMatch(route,/NEXT_PUBLIC_MAINTENANCE/);
});
