import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {browserObjectKey,diagnosticBody,presignBrowserDiagnosticPut,signLease,verifyLease} from "../src/modules/ipa/r2-browser-diag";
import {signDiagnosticObjectRequest} from "../src/modules/ipa/r2-signed-requests";
const cfg={accountId:"a".repeat(32),bucket:"an-ipa-quarantine",
 accessKeyId:"TESTACCESSKEY",secretAccessKey:"SYNTHETIC_ONLY"};
const id="00000000-0000-4000-8000-000000000001",when=new Date("2026-11-03T00:00:00Z");
test("synthetic browser PUT only scopes a short-lived diagnostics object",()=>{
 const url=new URL(presignBrowserDiagnosticPut(cfg,id,when));
 assert.equal(url.host,cfg.accountId+".r2.cloudflarestorage.com");
 assert.equal(url.pathname,"/"+cfg.bucket+"/"+browserObjectKey(id));
 assert.equal(url.searchParams.get("X-Amz-Expires"),"60");
 assert.equal(url.searchParams.get("X-Amz-SignedHeaders"),"content-length;content-type;host");
 assert.match(url.searchParams.get("X-Amz-Signature")||"",/^[a-f0-9]{64}$/);
 assert.ok(!url.toString().includes(cfg.secretAccessKey));
 assert.ok(Buffer.byteLength(diagnosticBody(id))<256);
 assert.notEqual(presignBrowserDiagnosticPut({...cfg,secretAccessKey:"DIFFERENT"},id,when),url.toString());
 assert.doesNotThrow(()=>signDiagnosticObjectRequest(cfg,browserObjectKey(id),"DELETE"));
 assert.throws(()=>presignBrowserDiagnosticPut(cfg,"../../quarantine",when));
});
test("lease is scoped to admin, expires, and rejects tampering",()=>{
 const key=Buffer.alloc(32,42),now=100000;
 const lease=signLease(id,now+60000,"admin-1",key);
 assert.equal(verifyLease(lease,"admin-1",key,now),true);
 assert.equal(verifyLease(lease,"admin-2",key,now),false);
 assert.equal(verifyLease(lease,"admin-1",key,now+60001),false);
 assert.equal(verifyLease({...lease,id:"00000000-0000-4000-8000-000000000002"},"admin-1",key,now),false);
 assert.equal(verifyLease({...lease,expiresAt:now+90000},"admin-1",key,now),false);
});
test("browser test requires Preview, Admin, CSRF origin and always deletes",()=>{
 const route=readFileSync(new URL("../src/app/api/admin/storage/browser-test/route.ts",import.meta.url),"utf8");
 const client=readFileSync(new URL("../src/components/r2-browser-check.tsx",import.meta.url),"utf8");
 assert.match(route,/VERCEL_ENV!=="preview"/);
 assert.match(route,/verifiedAdmin/);
 assert.match(route,/sameOrigin/);
 assert.match(route,/verifyLease/);
 assert.match(route,/send\("DELETE"\)/);
 assert.match(route,/bytes\.equals\(expected\)/);
 assert.doesNotMatch(route,/R2_PRIVATE_UPLOAD_ENABLED/);
 assert.match(client,/mode:"cors"/);
 assert.match(client,/credentials:"omit"/);
 assert.match(client,/application\/octet-stream/);
});
