import {createHash,createHmac} from "node:crypto";
import type {PrivateR2} from "./r2-presign";

/** Only for tiny synthetic Preview diagnostics; NEVER user-supplied IPA. */
export type DiagnosticMethod="PUT"|"HEAD"|"DELETE";
const sha256=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");
const hmac=(key:Buffer|string,value:string)=>createHmac("sha256",key).update(value).digest();
const encode=(value:string)=>encodeURIComponent(value).replace(/[!'()*]/g,char=>"%"+char.charCodeAt(0).toString(16).toUpperCase());
export function signDiagnosticObjectRequest(
 config:PrivateR2,key:string,method:DiagnosticMethod,body:Buffer=Buffer.alloc(0),
 now=new Date()
):{url:string;headers:Record<string,string>} {
 if(!/^[a-f0-9]{32}$/i.test(config.accountId)||
  !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket)||
  !config.accessKeyId||!config.secretAccessKey)throw Error("R2_CONFIG_INVALID");
 // Only a server-generated UUID under diagnostics/ is accepted, not other objects.
 if(!/^diagnostics\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.txt$/i.test(key))
   throw Error("R2_DIAGNOSTIC_PATH_INVALID");
 if(method!=="PUT"&&body.length!==0)throw Error("UNEXPECTED_BODY");
 if(body.length>256)throw Error("DIAGNOSTIC_PAYLOAD_TOO_LARGE");
 if(!Number.isFinite(now.getTime()))throw Error("INVALID_DATE");
 const host=config.accountId.toLowerCase()+".r2.cloudflarestorage.com";
 const path="/"+encode(config.bucket)+"/"+key.split("/").map(encode).join("/");
 const stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,"");
 const day=stamp.slice(0,8),scope=day+"/auto/s3/aws4_request";
 const values:Record<string,string>={
  host,
  "x-amz-content-sha256":sha256(body),
  "x-amz-date":stamp
 };
 if(method==="PUT"){
  values["content-type"]="text/plain";
  values["if-none-match"]="*";
 }
 const sorted=Object.keys(values).sort();
 const canonicalHeaders=sorted.map(key=>key+":"+values[key].trim()+"\n").join("");
 const signedHeaders=sorted.join(";");
 const canonicalRequest=[method,path,"",canonicalHeaders,signedHeaders,sha256(body)].join("\n");
 const stringToSign=["AWS4-HMAC-SHA256",stamp,scope,sha256(canonicalRequest)].join("\n");
 const derived=hmac(hmac(hmac(hmac("AWS4"+config.secretAccessKey,day),"auto"),"s3"),"aws4_request");
 const signature=createHmac("sha256",derived).update(stringToSign).digest("hex");
 const authorization="AWS4-HMAC-SHA256 Credential="+config.accessKeyId+"/"+scope+
  ", SignedHeaders="+signedHeaders+", Signature="+signature;
 const headers:Record<string,string>={Authorization:authorization,
  "x-amz-date":stamp,"x-amz-content-sha256":sha256(body)};
 if(method==="PUT"){headers["Content-Type"]="text/plain";headers["If-None-Match"]="*";}
 return {url:"https://"+host+path,headers};
}
