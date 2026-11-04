import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {presignPrivateR2HeadBucket} from "../src/modules/ipa/r2-presign";
const cfg={accountId:"a".repeat(32),bucket:"an-ipa-quarantine",
 accessKeyId:"SYNTHETICKEY",secretAccessKey:"SYNTHETICSECRET"};
const when=new Date("2026-11-03T00:00:00Z");
test("HEAD only probes bucket, has 60s expiry and scoped SigV4 signature",()=>{
 const url=presignPrivateR2HeadBucket(cfg,when);
 const u=new URL(url);
 assert.equal(u.protocol,"https:");
 assert.equal(u.pathname,"/an-ipa-quarantine");
 assert.equal(u.searchParams.get("X-Amz-Expires"),"60");
 assert.equal(u.searchParams.get("X-Amz-SignedHeaders"),"host");
 assert.match(u.searchParams.get("X-Amz-Signature")||"",/^[0-9a-f]{64}$/);
 assert.ok(!url.includes(cfg.secretAccessKey));
 assert.equal(url,presignPrivateR2HeadBucket(cfg,when));
 assert.notEqual(url,presignPrivateR2HeadBucket({...cfg,secretAccessKey:"DIFFERENT"},when));
});
test("diagnostic must require admin and never expose secrets or send a file",()=>{
 const source=readFileSync(new URL("../src/app/api/admin/storage/health/route.ts",import.meta.url),"utf8");
 assert.match(source,/adminFromSession/);
 assert.match(source,/R2_STORAGE_DIAGNOSTICS_ENABLED/);
 assert.match(source,/VERCEL_ENV!=="preview"/);
 assert.match(source,/method:"HEAD"/);
 assert.doesNotMatch(source,/uploadUrl|presignPrivateIpaPut|req\.body/);
});
