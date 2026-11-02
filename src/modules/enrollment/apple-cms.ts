/**
 * Apple Profile Service CMS stage-2 verifier, designed to run in an isolated
 * worker with OpenSSL and a pin-verified Apple device-identity CA bundle.
 *
 * This DOES NOT implement SCEP phases, sign a .mobileconfig, or establish
 * that a profile has been installed. It never accepts unsigned claims.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeUdid } from "../devices/policy";

const runFile = promisify(execFile);
export interface CmsDeviceResponse {
  udid: string;
  challenge: string;
  iosVersion?: string;
}
const MAX_CMS_BYTES = 128 * 1024;
const MAX_PLIST_BYTES = 16 * 1024;
const APPLE_PLIST_DOCTYPE = '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">';

export function parseSignedDeviceAttributes(xml: string, expectedChallenge: string): CmsDeviceResponse {
  if (Buffer.byteLength(xml) > MAX_PLIST_BYTES || xml.includes("\u0000"))
    throw new Error("Device payload too large");
  let contents = xml.trim().replace(/^<\?xml\s+version="1\.0"\s+encoding="UTF-8"\s*\?>/i,"").trim();
  if (contents.startsWith("<!DOCTYPE")) {
    if (!contents.startsWith(APPLE_PLIST_DOCTYPE)) throw new Error("Unexpected plist declaration");
    contents = contents.slice(APPLE_PLIST_DOCTYPE.length).trim();
  }
  if (/<!|<\?|&[#a-z]/i.test(contents)) throw new Error("Unsupported XML markup");
  if (!/^<plist\s+version="1\.0">\s*<dict>[\s\S]*<\/dict>\s*<\/plist>$/.test(contents))
    throw new Error("Expected a top-level plist dictionary");
  const inner = contents.replace(/^<plist\s+version="1\.0">\s*<dict>/,"")
    .replace(/<\/dict>\s*<\/plist>$/,"").trim();
  // Deliberately narrow parser: XML data must be a flat plist of strings/data.
  // No nested XML, DTD fetching, entities, arrays or duplicate keys are permitted.
  const fields = new Map<string,string>();
  const pair = /<key>([A-Z_]{1,40})<\/key>\s*<(string|data)>([A-Za-z0-9_+/\-=.]{0,512})<\/\2>/y;
  let offset=0;
  while(offset < inner.length) {
    while(/\s/.test(inner[offset]||"") && offset<inner.length) offset++;
    if(offset === inner.length) break;
    pair.lastIndex=offset;
    const match=pair.exec(inner);
    if(!match) throw new Error("Unsupported device attribute field");
    const [,name,type,value]=match;
    if(fields.has(name)) throw new Error("Duplicate device attribute");
    let parsed=value;
    if(type==="data") {
      if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
        throw new Error("Invalid base64 device attribute");
      parsed=Buffer.from(value,"base64").toString("utf8");
    }
    fields.set(name,parsed);
    offset=pair.lastIndex;
  }
  const challenge=fields.get("CHALLENGE"), udid=fields.get("UDID");
  if(!challenge || challenge!==expectedChallenge || !/^[A-Za-z0-9_-]{40,64}$/.test(challenge))
    throw new Error("Mismatched profile challenge");
  if(!udid) throw new Error("Missing UDID");
  const response:CmsDeviceResponse={udid:normalizeUdid(udid),challenge};
  if(fields.has("VERSION")) response.iosVersion=fields.get("VERSION")?.slice(0,32);
  return response;
}

export async function verifyAppleSignedDeviceCms(
  cmsDer: Buffer, expectedChallenge: string, pinnedCaPem: string
): Promise<CmsDeviceResponse> {
  if(!Buffer.isBuffer(cmsDer) || cmsDer.length<64 || cmsDer.length>MAX_CMS_BYTES)
    throw new Error("Invalid CMS size");
  if(!pinnedCaPem.includes("-----BEGIN CERTIFICATE-----") ||
    Buffer.byteLength(pinnedCaPem)>65536)
    throw new Error("Missing pinned device CA");
  const dir=await mkdtemp(join(tmpdir(),"an-ipa-apple-cms-"));
  try {
    const input=join(dir,"device.cms"), trust=join(dir,"trusted-ca.pem"), content=join(dir,"verified.xml");
    await Promise.all([
      writeFile(input,cmsDer,{mode:0o600}),
      writeFile(trust,pinnedCaPem,{mode:0o600})
    ]);
    try {
      await runFile("openssl",[
        "cms","-verify","-verify_retcode","-inform","DER","-binary",
        "-in",input,"-out",content,"-CAfile",trust,
        "-no-CApath","-no-CAstore","-purpose","any"
      ],{timeout:5000,maxBuffer:65536,env:{PATH:process.env.PATH}});
    } catch {
      // Do not echo OpenSSL stderr, CMS contents or device identifiers into logs.
      throw new Error("Device CMS or certificate-chain verification failed");
    }
    const buf=await readFile(content);
    if(buf.length>MAX_PLIST_BYTES) throw new Error("Device response too large");
    return parseSignedDeviceAttributes(buf.toString("utf8"),expectedChallenge);
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
}
