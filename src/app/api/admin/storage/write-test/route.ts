import "server-only";
import {randomUUID} from "node:crypto";
import {NextRequest} from "next/server";
import {adminConfig,verifiedAdmin} from "@/modules/auth/admin-server";
import {sameOrigin,unsealAdminSession,ADMIN_COOKIE} from "@/modules/auth/session";
import {validateR2,type PrivateR2} from "@/modules/ipa/r2-presign";
import {signDiagnosticObjectRequest,type DiagnosticMethod} from "@/modules/ipa/r2-signed-requests";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const fixedHeaders={"Cache-Control":"no-store, private",
 "Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
function result(state:string,status:number){
 return Response.json({state},{status,headers:fixedHeaders});
}
export async function POST(req:NextRequest){
 const cfg=adminConfig();
 if(!cfg||process.env.VERCEL_ENV!=="preview"||
  process.env.R2_STORAGE_DIAGNOSTICS_ENABLED!=="true"||
  process.env.R2_WRITE_DIAGNOSTICS_ENABLED!=="true")
  return result("WRITE_TEST_DISABLED",503);
 if(!sameOrigin(req.headers.get("origin"),cfg.origin))return result("INVALID_ORIGIN",403);
 const raw=req.cookies.get(ADMIN_COOKIE)?.value;
 const session=raw?unsealAdminSession(raw,cfg.cookieKey):null;
 if(!session||!await verifiedAdmin(session.accessToken,cfg))
  return result("UNAUTHORIZED",401);

 const e=process.env;
 const r2:PrivateR2={
  accountId:e.R2_ACCOUNT_ID||"",bucket:e.R2_BUCKET||"",
  accessKeyId:e.R2_ACCESS_KEY_ID||"",secretAccessKey:e.R2_SECRET_ACCESS_KEY||""
 };
 if(!validateR2(r2))return result("STORAGE_CONFIG_INVALID",503);
 const id=randomUUID();
 const key="diagnostics/"+id+".txt";
 const body=Buffer.from("AN IPA STORE R2 ephemeral synthetic write diagnostic "+id+"\n","utf8");
 async function send(method:DiagnosticMethod){
  const input=method==="PUT"?body:Buffer.alloc(0);
  const signed=signDiagnosticObjectRequest(r2,key,method,input);
  return fetch(signed.url,{method,headers:signed.headers,
   ...(method==="PUT"?{body:input}:{ }),
   redirect:"error",cache:"no-store",signal:AbortSignal.timeout(7500)});
 }
 let state="R2_TEST_FAILED";
 // A network timeout after PUT may have persisted the object, so DELETE is
 // attempted even when the PUT response was lost.
 try{
  const put=await send("PUT");
  if(put.ok){
   const head=await send("HEAD");
   state=head.ok && head.headers.get("content-length")===String(body.length)
    ?"R2_WRITE_AND_READ_OK":"R2_VERIFY_FAILED";
  }else{
   state=put.status===401||put.status===403?"R2_WRITE_PERMISSION_DENIED":"R2_WRITE_REJECTED";
  }
 }catch{state="R2_WRITE_NETWORK_ERROR";}
 let deleted=false;
 try{
  const response=await send("DELETE");
  deleted=response.ok;
 }catch{deleted=false;}
 if(!deleted){
  // Never print keys, secret credentials, presigned URLs or request headers.
  console.error("R2 synthetic write-test cleanup failed");
  return result("R2_CLEANUP_FAILED",503);
 }
 return state==="R2_WRITE_AND_READ_OK"
  ?result("R2_WRITE_TEST_OK",200)
  :result(state,503);
}
