import {test} from "node:test";
import assert from "node:assert/strict";
import {presignPrivateIpaPut,MAX_DIRECT_IPA_BYTES} from "../src/modules/ipa/r2-presign";
const cfg={
 accountId:"a".repeat(32),bucket:"an-ipa-quarantine",
 accessKeyId:"TESTACCESSKEY",secretAccessKey:"SYNTHETIC_SECRET_DO_NOT_USE"
};
const id="00000000-0000-4000-8000-000000000001";
const now=new Date("2026-11-03T00:00:00Z");
test("presigned URL is short-lived, scoped to unique object and bounded to exact length",()=>{
 const grant=presignPrivateIpaPut(cfg,5*1024*1024,now,id);
 const url=new URL(grant.url);
 assert.equal(url.protocol,"https:");
 assert.equal(url.host,cfg.accountId+".r2.cloudflarestorage.com");
 assert.equal(url.pathname,"/"+cfg.bucket+"/quarantine/"+id+".ipa");
 assert.equal(url.searchParams.get("X-Amz-Expires"),"300");
 assert.equal(url.searchParams.get("X-Amz-SignedHeaders"),"content-length;content-type;host;if-none-match");
 assert.match(url.searchParams.get("X-Amz-Signature")||"",/^[0-9a-f]{64}$/);
 assert.ok(!grant.url.includes(cfg.secretAccessKey));
 assert.deepEqual(grant.headers,{"Content-Type":"application/octet-stream","If-None-Match":"*"});
 assert.equal(grant.url,presignPrivateIpaPut(cfg,5*1024*1024,now,id).url);
 assert.notEqual(grant.url,presignPrivateIpaPut(cfg,5*1024*1024+1,now,id).url);
});
test("bad paths, oversized or invalid size cannot obtain an upload grant",()=>{
 for(const size of [0,-1,NaN,1.5,MAX_DIRECT_IPA_BYTES+1])
  assert.throws(()=>presignPrivateIpaPut(cfg,size,now,id));
 assert.throws(()=>presignPrivateIpaPut({...cfg,bucket:"../public"},500,now,id));
 assert.throws(()=>presignPrivateIpaPut(cfg,500,now,"../../danger"));
});
