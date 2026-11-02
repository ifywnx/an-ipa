import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomToken } from "../src/modules/enrollment/secure";
import { parseSignedDeviceAttributes, verifyAppleSignedDeviceCms } from "../src/modules/enrollment/apple-cms";

const challenge=randomToken(), udid="A".repeat(40);
function plist(value=udid,token=challenge) {
 return '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>'+
 '<key>UDID</key><string>'+value+'</string>'+
 '<key>VERSION</key><string>26.0</string>'+
 '<key>CHALLENGE</key><string>'+token+'</string></dict></plist>';
}
test("strict profile parser accepts a signed attribute payload only when challenge matches",()=>{
 assert.deepEqual(parseSignedDeviceAttributes(plist(),challenge),{udid,challenge,iosVersion:"26.0"});
 assert.throws(()=>parseSignedDeviceAttributes(plist(udid,randomToken()),challenge),/challenge/);
 assert.throws(()=>parseSignedDeviceAttributes(plist("INVALID",challenge),challenge),/UDID/);
 assert.throws(()=>parseSignedDeviceAttributes(plist().replace("</dict>","<key>UDID</key><string>"+udid+"</string></dict>"),challenge),/Duplicate/);
 assert.throws(()=>parseSignedDeviceAttributes(plist().replace("<plist","<!ENTITY x SYSTEM 'file:///etc/passwd'><plist"),challenge));
});
test("real CMS verification checks signatures AND certificate chain against configured trust anchor",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"an-ipa-cms-test-"));
 const cmd=(...args:string[])=>execFileSync("openssl",args,{cwd:dir,stdio:"pipe",timeout:10000});
 try {
  cmd("req","-x509","-newkey","rsa:2048","-nodes","-keyout","root.key","-out","root.pem","-days","1","-subj","/CN=TEST-ONLY-CA");
  cmd("req","-newkey","rsa:2048","-nodes","-keyout","device.key","-out","device.csr","-subj","/CN=SYNTHETIC-DEVICE");
  cmd("x509","-req","-in","device.csr","-CA","root.pem","-CAkey","root.key","-CAcreateserial","-out","device.pem","-days","1");
  writeFileSync(join(dir,"device.xml"),plist());
  cmd("cms","-sign","-binary","-nodetach","-in","device.xml","-signer","device.pem","-inkey","device.key","-outform","DER","-out","signed.cms");
  const der=readFileSync(join(dir,"signed.cms"));
  const ca=readFileSync(join(dir,"root.pem"),"utf8");
  const response=await verifyAppleSignedDeviceCms(der,challenge,ca);
  assert.equal(response.udid,udid);
  await assert.rejects(verifyAppleSignedDeviceCms(der,randomToken(),ca),/challenge/);
  const fake=ca.replace("-----BEGIN CERTIFICATE-----","-----BEGIN TEST CERTIFICATE-----");
  await assert.rejects(verifyAppleSignedDeviceCms(der,challenge,fake));
  const wrongRoot=readFileSync(join(dir,"device.pem"),"utf8");
  await assert.rejects(verifyAppleSignedDeviceCms(der,challenge,wrongRoot),/certificate-chain/);
  const damaged=Buffer.from(der);damaged[damaged.length-50]^=0x01;
  await assert.rejects(verifyAppleSignedDeviceCms(damaged,challenge,ca));
 } finally {rmSync(dir,{recursive:true,force:true});}
});
