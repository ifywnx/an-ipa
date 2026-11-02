import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src/modules/auth/admin-server.ts",import.meta.url),"utf8");
test("Admin role lookup uses auth-user RLS and not a database service key",()=>{
 assert.match(source,/Authorization:"Bearer "\+accessToken/);
 assert.match(source,/apikey:cfg.publishableKey/);
 assert.doesNotMatch(source,/apikey:cfg.secretKey|SUPABASE_SECRET_KEY/);
 assert.match(source,/role","eq.admin"/);
});
test("Preview login gate never bypasses production WAF gate",()=>{
 assert.match(source,/e.VERCEL_ENV==="preview"/);
 assert.match(source,/ADMIN_AUTH_PREVIEW_PROTECTED/);
 assert.match(source,/ADMIN_AUTH_WAF_READY/);
});
