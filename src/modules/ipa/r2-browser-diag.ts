import {createHash,createHmac,randomUUID,timingSafeEqual} from "node:crypto";
import {validateR2,type PrivateR2} from "./r2-presign";

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest=(text:string)=>createHash("sha256").update(text).digest("hex");
const hmac=(key:Buffer|string,text:string)=>createHmac("sha256",key).update(text).digest();
const encode=(x:string)=>encodeURIComponent(x).replace(/[!'()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());

export const diagnosticBody=(id:string)=>{
 if(!uuidPattern.test(id))throw Error("INVALID_BROWSER_DIAGNOSTIC_ID");
 return "AN IPA STORE browser CORS synthetic diagnostic "+id+"\n";
};
export const browserObjectKey=(id:string)=>{
 if(!uuidPattern.test(id))throw Error("INVALID_BROWSER_DIAGNOSTIC_ID");
 return "diagnostics/browser-"+id+".bin";
};
export function newBrowserDiagnosticId():string{return randomUUID();}

/**
 * Creates a short-lived, private, scoped PUT for a synthetic (under 256B) file.
 * Browser sets Content-Length itself. Sign exact length and Content-Type to
 * guard against oversized uploads; test the assumption against iOS Safari/R2.
 */
export function presignBrowserDiagnosticPut(cfg:PrivateR2,id:string,now=new Date()):string{
 if(!validateR2(cfg))throw Error("BAD_R2_CONFIG");
 const body=diagnosticBody(id),size=Buffer.byteLength(body);
 if(size>256||!Number.isFinite(now.getTime()))throw Error("BAD_DIAGNOSTIC");
 const key=browserObjectKey(id);
 const host=cfg.accountId.toLowerCase()+".r2.cloudflarestorage.com";
 const path="/"+encode(cfg.bucket)+"/"+key.split("/").map(encode).join("/");
 const stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,"");
 const day=stamp.slice(0,8),scope=day+"/auto/s3/aws4_request";
 const queryValues:Record<string,string>={
  "X-Amz-Algorithm":"AWS4-HMAC-SHA256",
  "X-Amz-Content-Sha256":"UNSIGNED-PAYLOAD",
  "X-Amz-Credential":cfg.accessKeyId+"/"+scope,
  "X-Amz-Date":stamp,
  "X-Amz-Expires":"60",
  "X-Amz-SignedHeaders":"content-length;content-type;host"
 };
 const query=Object.entries(queryValues).map(([k,v])=>encode(k)+"="+encode(v)).sort().join("&");
 const request=["PUT",path,query,
  "content-length:"+size+"\ncontent-type:application/octet-stream\nhost:"+host+"\n",
  "content-length;content-type;host","UNSIGNED-PAYLOAD"].join("\n");
 const toSign="AWS4-HMAC-SHA256\n"+stamp+"\n"+scope+"\n"+digest(request);
 const derived=hmac(hmac(hmac(hmac("AWS4"+cfg.secretAccessKey,day),"auto"),"s3"),"aws4_request");
 const signature=createHmac("sha256",derived).update(toSign).digest("hex");
 return "https://"+host+path+"?"+query+"&X-Amz-Signature="+signature;
}
export interface BrowserLease {id:string;expiresAt:number;proof:string}
export function signLease(id:string,expiresAt:number,adminId:string,key:Buffer):BrowserLease{
 if(!uuidPattern.test(id)||!Number.isSafeInteger(expiresAt)||!adminId||key.length!==32)throw Error("BAD_LEASE");
 const token=createHmac("sha256",key).update("AN-IPA-R2-CORS-v1\n"+adminId+"\n"+id+"\n"+expiresAt).digest("base64url");
 return {id,expiresAt,proof:token};
}
export function verifyLease(input:unknown,adminId:string,key:Buffer,now=Date.now()):input is BrowserLease{
 if(!input||typeof input!=="object"||!adminId||key.length!==32)return false;
 const l=input as Record<string,unknown>;
 if(typeof l.id!=="string"||!uuidPattern.test(l.id)||
  typeof l.expiresAt!=="number"||!Number.isSafeInteger(l.expiresAt)||
  l.expiresAt<now||l.expiresAt>now+120000||
  typeof l.proof!=="string"||!/^[\w-]{43}$/.test(l.proof))return false;
 const expected=signLease(l.id,l.expiresAt,adminId,key).proof;
 const a=Buffer.from(l.proof),b=Buffer.from(expected);
 return a.length===b.length&&timingSafeEqual(a,b);
}
