import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const paths = execFileSync("git",["ls-files","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
const errors=[];
for(const path of paths){
 if(/\.(p12|pfx|pem|key|p8|mobileprovision|provisionprofile|ipa|cer|mobileconfig)$/i.test(path) || /(^|\/)\.env(?!\.example$)(?:$|\.)/.test(path)) errors.push(`Forbidden file: ${path}`);
 const text=readFileSync(path,"utf8");
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) || /(?:gh[pousr]_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16})/.test(text)) errors.push(`Possible secret: ${path}`);
}
if(errors.length){console.error(errors.join("\n"));process.exit(1);}
console.log(`Checked ${paths.length} tracked files: no prohibited assets or recognized secrets. This is a baseline scan, not a full secret audit.`);
