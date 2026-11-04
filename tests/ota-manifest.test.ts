import { test } from "node:test";
import assert from "node:assert/strict";
import {buildOtaManifest,buildItmsServicesUrl,denyOtaGrant,OtaDenied,type VerifiedOtaGrant} from "../src/modules/ota/manifest";
const now=new Date("2026-11-03T00:00:00Z");
const evidence={deviceStatus:"approved",appleRegistered:true,deviceUdid:"SYNTHETIC",profileUdids:["SYNTHETIC"],profileExpiresAt:"2026-12-03T00:00:00Z",signatureVerified:true,entitlementsMatch:true,bundleId:"com.example.app",profileBundleId:"com.example.app",distributionAuthorized:true};
const grant:VerifiedOtaGrant={evidence,appPublished:true,versionPublished:true,artifactVerified:true,distributionRightsReviewed:true,
  artifactSha256:"a".repeat(64),bundleIdentifier:"com.example.app",version:"1.0.2",title:"Example & Demo",
  ipaUrl:"https://ipa.example.test/build.ipa?token=x&expires=123",manifestUrl:"https://app.example.test/manifest/123.plist?token=abc",
  grantExpiresAt:"2026-11-03T00:05:00Z"};
const hosts=["ipa.example.test","app.example.test"];
test("synthetic verified grant renders escaped plist with HTTPS IPA",()=>{
  const xml=buildOtaManifest(grant,hosts,now);
  assert.match(xml,/software-package/);assert.match(xml,/Example &amp; Demo/);assert.match(xml,/token=x&amp;expires=123/);
  assert.match(buildItmsServicesUrl(grant,hosts,now),/^itms-services:\/\/\?action=download-manifest&url=https%3A%2F%2F/);
});
test("unsigned, unregistered, missing device or expired profile all fail closed",()=>{
 for (const change of [
  {artifactVerified:false},
  {evidence:{...evidence,signatureVerified:false}},
  {evidence:{...evidence,appleRegistered:false}},
  {evidence:{...evidence,profileUdids:[]}},
  {evidence:{...evidence,profileExpiresAt:"2026-01-01T00:00:00Z"}},
  {distributionRightsReviewed:false},
  {grantExpiresAt:"2026-11-03T03:00:00Z"},
  {ipaUrl:"http://ipa.example.test/untrusted.ipa"},
  {ipaUrl:"https://evil.example.test/app.ipa"}
 ]) assert.throws(()=>buildOtaManifest({...grant,...change},hosts,now),OtaDenied);
});
test("rejects XML control chars and untrusted host",()=>{
 assert.ok(denyOtaGrant({...grant,title:"bad\u0000name"},hosts,now).length>0);
 assert.ok(denyOtaGrant(grant,[],now).length>0);
});
