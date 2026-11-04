import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {signDiagnosticObjectRequest} from "../src/modules/ipa/r2-signed-requests";
const config={accountId:"a".repeat(32),bucket:"an-ipa-quarantine",accessKeyId:"SYNTHETIC",
 secretAccessKey:"SYNTHETIC_ONLY_NEVER_DEPLOY"};
const key="diagnostics/00000000-0000-4000-8000-000000000001.txt";
const now=new Date("2026-11-03T00:00:00Z");
test("S3 signatures vary with method/body and never include secret",()=>{
 const body=Buffer.from("synthetic test\n");
 const put=signDiagnosticObjectRequest(config,key,"PUT",body,now);
 const head=signDiagnosticObjectRequest(config,key,"HEAD",Buffer.alloc(0),now);
 const get=signDiagnosticObjectRequest(config,key,"GET",Buffer.alloc(0),now);
 const del=signDiagnosticObjectRequest(config,key,"DELETE",Buffer.alloc(0),now);
 assert.ok(put.url.startsWith("https://"+config.accountId+".r2.cloudflarestorage.com/an-ipa-quarantine/diagnostics/"));
 assert.equal(put.url,head.url);
 assert.equal(head.url,del.url);
 assert.equal(get.url,del.url);
 assert.match(put.headers.Authorization,/^AWS4-HMAC-SHA256 Credential=/);
 assert.match(put.headers.Authorization,/Signature=[a-f0-9]{64}$/);
 assert.notEqual(put.headers.Authorization,head.headers.Authorization);
 assert.notEqual(head.headers.Authorization,del.headers.Authorization);
 assert.notEqual(get.headers.Authorization,head.headers.Authorization);
 assert.ok(!JSON.stringify(put).includes(config.secretAccessKey));
 assert.equal(put.headers["If-None-Match"],"*");
 assert.notEqual(put.headers.Authorization,signDiagnosticObjectRequest(config,key,"PUT",Buffer.from("different"),now).headers.Authorization);
});
test("diagnostics cannot target IPA objects or arbitrary paths",()=>{
 for(const path of ["quarantine/app.ipa","diagnostics/../secret.txt","diagnostics/sample.txt"])
  assert.throws(()=>signDiagnosticObjectRequest(config,path,"DELETE"));
 assert.throws(()=>signDiagnosticObjectRequest(config,key,"HEAD",Buffer.from("bad")));
 assert.throws(()=>signDiagnosticObjectRequest(config,key,"PUT",Buffer.alloc(257)));
});
test("write test must require fresh Admin, Preview origin and separate flag",()=>{
 const route=readFileSync(new URL("../src/app/api/admin/storage/write-test/route.ts",import.meta.url),"utf8");
 assert.match(route,/verifiedAdmin/);
 assert.match(route,/VERCEL_ENV!=="preview"/);
 assert.match(route,/R2_WRITE_DIAGNOSTICS_ENABLED/);
 assert.match(route,/sameOrigin/);
 assert.match(route,/send\("DELETE"\)/);
 assert.match(route,/send\("GET"\)/);
 assert.match(route,/actual\.equals\(body\)/);
 assert.match(route,/readTinyObject\(get,256\)/);
 assert.match(route,/R2_WRITE_READ_OK_HEAD_INCONCLUSIVE/);
 assert.doesNotMatch(route,/R2_PRIVATE_UPLOAD_ENABLED/);
});
