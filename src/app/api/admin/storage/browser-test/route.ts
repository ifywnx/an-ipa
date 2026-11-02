import "server-only";
import {NextRequest} from "next/server";
import {adminConfig,verifiedAdmin} from "@/modules/auth/admin-server";
import {sameOrigin,unsealAdminSession,ADMIN_COOKIE} from "@/modules/auth/session";
import {validateR2,type PrivateR2} from "@/modules/ipa/r2-presign";
import {signDiagnosticObjectRequest} from "@/modules/ipa/r2-signed-requests";
import {browserObjectKey,diagnosticBody,newBrowserDiagnosticId,presignBrowserDiagnosticPut,signLease,verifyLease} from "@/modules/ipa/r2-browser-diag";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer",
 "X-Content-Type-Options":"nosniff"};
function result(state:string,status:number){return Response.json({state},{status,headers});}
async function readSmall(response:Response,limit:number):Promise<Buffer|null>{
 const header=response.headers.get("content-length");
 if(header && (!/^\d+$/.test(header)||Number(header)>limit))return null;
 if(!response.body)return null;
 const reader=response.body.getReader(),chunks:Buffer[]=[];
 let size=0;
 try{
  for(;;){
   const part=await reader.read();
   if(part.done)break;
   size+=part.value.byteLength;
   if(size>limit)return null;
   chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks,size);
 }finally{
  await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
}
export async function POST(req:NextRequest){
 const cfg=adminConfig();
 if(!cfg||process.env.VERCEL_ENV!=="preview"||
  process.env.R2_STORAGE_DIAGNOSTICS_ENABLED!=="true"||
  process.env.R2_BROWSER_DIAGNOSTICS_ENABLED!=="true")
  return result("BROWSER_TEST_DISABLED",503);
 if(!sameOrigin(req.headers.get("origin"),cfg.origin)||
  !req.headers.get("content-type")?.startsWith("application/json"))
  return result("INVALID_ORIGIN",403);
 const sealed=req.cookies.get(ADMIN_COOKIE)?.value;
 const session=sealed?unsealAdminSession(sealed,cfg.cookieKey):null;
 if(!session)return result("UNAUTHORIZED",401);
 const admin=await verifiedAdmin(session.accessToken,cfg);
 if(!admin)return result("UNAUTHORIZED",401);
 const e=process.env;
 const r2:PrivateR2={accountId:e.R2_ACCOUNT_ID||"",bucket:e.R2_BUCKET||"",
  accessKeyId:e.R2_ACCESS_KEY_ID||"",secretAccessKey:e.R2_SECRET_ACCESS_KEY||""};
 if(!validateR2(r2))return result("R2_CONFIG_INVALID",503);
 let data:unknown;
 try{
  if(Number(req.headers.get("content-length")||0)>1024)return result("BAD_REQUEST",400);
  const body=await req.text();if(body.length>1024)return result("BAD_REQUEST",400);
  data=JSON.parse(body);
 }catch{return result("BAD_REQUEST",400);}
 if(!data||typeof data!=="object")return result("BAD_REQUEST",400);
 const input=data as Record<string,unknown>;
 if(input.action==="prepare"){
  try{
   const id=newBrowserDiagnosticId();
   const lease=signLease(id,Date.now()+90000,admin.id,cfg.cookieKey);
   const uploadUrl=presignBrowserDiagnosticPut(r2,id);
   return Response.json({state:"PREPARED",lease,content:diagnosticBody(id),
    uploadUrl,contentType:"application/octet-stream"},{headers});
  }catch{return result("R2_CONFIG_INVALID",503);}
 }
 if(input.action!=="verify"||!verifyLease(input.lease,admin.id,cfg.cookieKey))
  return result("INVALID_OR_EXPIRED_LEASE",403);
 const lease=input.lease;
 const key=browserObjectKey(lease.id),expected=Buffer.from(diagnosticBody(lease.id),"utf8");
 const send=async(method:"GET"|"DELETE")=>{
  const signed=signDiagnosticObjectRequest(r2,key,method);
  return fetch(signed.url,{method,headers:signed.headers,redirect:"error",
   cache:"no-store",signal:AbortSignal.timeout(7500)});
 };
 let verified="BROWSER_REMOTE_FAILURE";
 try{
  const obj=await send("GET");
  if(obj.ok){
   const bytes=await readSmall(obj,256);
   verified=bytes&&bytes.equals(expected)?"BROWSER_BYTES_MATCH":"BROWSER_CONTENT_MISMATCH";
  }else verified=obj.status===404?"BROWSER_NOT_UPLOADED":
   obj.status===401||obj.status===403?"BROWSER_READ_FORBIDDEN":"BROWSER_REMOTE_FAILURE";
 }catch{verified="BROWSER_REMOTE_FAILURE";}
 let deleted=false;
 try{const d=await send("DELETE");deleted=d.ok;}catch{deleted=false;}
 if(!deleted){
  // No keys, object names, presigned URLs or request headers in logs.
  console.error("Browser synthetic diagnostic cleanup failed");
  return result("BROWSER_CLEANUP_FAILED",503);
 }
 // Client's report distinguishes browser CORS success from a write that may
 // have persisted despite a CORS response-block. Server never trusts it for
 // IPA eligibility or device authorization.
 if(verified==="BROWSER_BYTES_MATCH"){
  return input.browserSucceeded===true?result("BROWSER_CORS_PUT_VERIFIED",200)
   :result("BROWSER_BYTES_SAVED_BUT_CORS_UNCONFIRMED",200);
 }
 return result(verified,503);
}
