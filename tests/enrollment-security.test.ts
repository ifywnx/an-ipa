import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { sha256, randomToken, keyFromBase64, keyedHash, encryptUdid, decryptUdid, verifyProviderAttestation } from "../src/modules/enrollment/secure";
const udid="A".repeat(40);
const key=keyFromBase64(Buffer.alloc(32,21).toString("base64"));
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const pub=publicKey.export({format:"der",type:"spki"}).toString("base64");
const now=new Date("2026-11-03T08:00:00Z");
function body(patch:Record<string,unknown>={}) {
 return JSON.stringify({
  protocol:"apple-profile-service-cms-v1",issuer:"https://issuer.test",audience:"https://store.test",
  challenge:randomToken(),udid,issued_at:now.toISOString(),provider_reference:"verified-fixture",
  device_signature_verified:true,apple_device_chain_trusted:true,...patch
 });
}
function signed(raw:string) {return sign(null,Buffer.from(raw),privateKey).toString("base64");}
test("one-time token generator produces high entropy random challenges",()=>{
 const a=randomToken(),b=randomToken();
 assert.notEqual(a,b);assert.match(a,/^[A-Za-z0-9_-]{40,64}$/);
 assert.match(sha256(a),/^[0-9a-f]{64}$/);
});
test("UDID is AES-GCM sealed and cannot be altered",()=>{
 const sealed=encryptUdid(key,udid);
 assert.ok(!sealed.includes(udid)); assert.equal(decryptUdid(key,sealed),udid);
 assert.throws(()=>decryptUdid(key,sealed.slice(0,-2)+"xx"));
 assert.notEqual(keyedHash(key,"ip",udid),keyedHash(key,"udid",udid));
});
test("trusted issuer signed attestation is accepted ONLY for exact audience",()=>{
 const raw=body();
 const v=verifyProviderAttestation(raw,signed(raw),pub,"https://store.test","https://issuer.test",now);
 assert.equal(v.udid,udid);
 assert.throws(()=>verifyProviderAttestation(raw,signed(raw),pub,"https://attacker.test","https://issuer.test",now));
});
test("invalid, expired, replay-like or unsigned evidence fails",()=>{
 const r=body();
 assert.throws(()=>verifyProviderAttestation(r,"AAAAAAAA",pub,"https://store.test","https://issuer.test",now));
 for(const patch of [
  {device_signature_verified:false},{apple_device_chain_trusted:false},
  {issued_at:"2026-11-02T00:00:00Z"},{udid:"not-udid"},
  {protocol:"fake-service"}
 ]) {
  const v=body(patch);
  assert.throws(()=>verifyProviderAttestation(v,signed(v),pub,"https://store.test","https://issuer.test",now));
 }
});
test("migration blocks browser roles, implements atomic consume and rate limit",()=>{
 const sql=readFileSync(new URL("../supabase/migrations/20261102211217_guest_enrollment_verified_provider_foundation.sql",import.meta.url),"utf8");
 assert.match(sql,/alter table public\.guest_enrollments enable row level security/);
 assert.match(sql,/revoke all on public\.guest_enrollments from public, anon, authenticated/);
 assert.match(sql,/status='pending' and expires_at>now\(\)/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/grant execute on function public\.complete_guest_enrollment.*service_role/);
});
