import {createHmac,createHash,randomUUID} from "node:crypto";

/** R2 S3 Signature V4 single-part private PUT. No credentials reach browser. */
import {MAX_DIRECT_IPA_BYTES} from "./upload-policy";
export {MAX_DIRECT_IPA_BYTES}; // larger files need multipart
export interface PrivateR2 {
 accountId:string;bucket:string;accessKeyId:string;secretAccessKey:string;
}
function sha256(value:string):string{return createHash("sha256").update(value).digest("hex");}
function hmac(key:Buffer|string,value:string):Buffer{return createHmac("sha256",key).update(value).digest();}
function enc(value:string):string{return encodeURIComponent(value).replace(/[!'()*]/g,ch=>"%"+ch.charCodeAt(0).toString(16).toUpperCase());}
export function validateR2(config:PrivateR2):boolean{
 return /^[a-f0-9]{32}$/i.test(config.accountId)&&
  /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket)&&
  !!config.accessKeyId&&config.accessKeyId.length<=128&&
  !!config.secretAccessKey&&config.secretAccessKey.length<=256;
}
export interface R2UploadGrant {
 url:string;headers:{"Content-Type":"application/octet-stream"};objectKey:string;expiresIn:number;
}
/**
 * Content-Length is included in SignedHeaders. The browser sends Content-Length
 * automatically, and an upload of another size must be rejected by signature check.
 * Validate this behavior against the *actual* R2 and Safari before enabling.
 */
export function presignPrivateIpaPut(
 config:PrivateR2,size:number,now=new Date(),identifier:string=randomUUID()
):R2UploadGrant {
 if(!validateR2(config))throw Error("Invalid R2 configuration");
 if(!Number.isSafeInteger(size)||size<100||size>MAX_DIRECT_IPA_BYTES)
  throw Error("IPA upload outside pilot size bounds");
 if(!/^[a-f0-9-]{36}$/.test(identifier))throw Error("Invalid upload identifier");
 const objectKey="quarantine/"+identifier+".ipa";
 const host=config.accountId.toLowerCase()+".r2.cloudflarestorage.com";
 const path="/"+enc(config.bucket)+"/"+objectKey.split("/").map(enc).join("/");
 const date=now.toISOString().replace(/[:-]|\.\d{3}/g,"");
 const day=date.slice(0,8);
 const scope=day+"/auto/s3/aws4_request";
 const signedHeaders="content-length;content-type;host";
 const params:Record<string,string>={
  "X-Amz-Algorithm":"AWS4-HMAC-SHA256",
  "X-Amz-Content-Sha256":"UNSIGNED-PAYLOAD",
  "X-Amz-Credential":config.accessKeyId+"/"+scope,
  "X-Amz-Date":date,
  "X-Amz-Expires":"300",
  "X-Amz-SignedHeaders":signedHeaders
 };
 const query=Object.entries(params).map(([k,v])=>enc(k)+"="+enc(v)).sort().join("&");
 const request="PUT\n"+path+"\n"+query+"\n"+
  "content-length:"+String(size)+"\n"+
  "content-type:application/octet-stream\n"+
  "host:"+host+"\n\n"+signedHeaders+"\nUNSIGNED-PAYLOAD";
 const stringToSign="AWS4-HMAC-SHA256\n"+date+"\n"+scope+"\n"+sha256(request);
 const kDate=hmac("AWS4"+config.secretAccessKey,day);
 const kRegion=hmac(kDate,"auto"),kService=hmac(kRegion,"s3");
 const signingKey=hmac(kService,"aws4_request");
 const signature=createHmac("sha256",signingKey).update(stringToSign).digest("hex");
 return {url:"https://"+host+path+"?"+query+"&X-Amz-Signature="+signature,
  headers:{"Content-Type":"application/octet-stream"},objectKey,expiresIn:300};
}
