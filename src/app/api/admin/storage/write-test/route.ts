import "server-only";
import {randomUUID} from "node:crypto";
import {NextRequest} from "next/server";
import {adminConfig,verifiedAdmin} from "@/modules/auth/admin-server";
import {sameOrigin,unsealAdminSession,ADMIN_COOKIE} from "@/modules/auth/session";
import {validateR2,type PrivateR2} from "@/modules/ipa/r2-presign";
import {signDiagnosticObjectRequest,type DiagnosticMethod} from "@/modules/ipa/r2-signed-requests";
/** Prevent unexpected remote content from consuming unbounded server memory. */
async function readTinyObject(response:Response,limit:number):Promise<Buffer|null>{
 const header=response.headers.get("content-length");
 if(header!==null && (!/^\d+$/.test(header)||Number(header)>limit))return null;
 if(!response.body)return null;
 const reader=response.body.getReader(),chunks:Buffer[]=[];
 let total=0;
 try{
  while(true){
   const part=await reader.read();
   if(part.done)break;
   total+=part.value.byteLength;
   if(total>limit)return null;
   chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks,total);
 }finally{
  await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
}


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
 // HEAD may be unavailable or omit size metadata on some intermediaries.
 // Independently read and compare the exact *synthetic* object bytes.
 // GET never touches an IPA and no object content reaches the browser.
 try{
  const put=await send("PUT");
  if(put.ok){
   let headVerified=false;
   try{
    const head=await send("HEAD");
    headVerified=head.ok && head.headers.get("content-length")===String(body.length);
   }catch{/* GET is the authoritative tiny-byte check below. */}
   const get=await send("GET");
   if(get.ok){
    const actual=await readTinyObject(get,256);
    if(actual && actual.equals(body))
      state=headVerified?"R2_WRITE_TEST_OK":"R2_WRITE_READ_OK_HEAD_INCONCLUSIVE";
    else
      state="R2_CONTENT_MISMATCH";
   }else{
    state=(get.status===401||get.status===403)?"R2_GET_PERMISSION_DENIED"
      :get.status===404?"R2_GET_NOT_FOUND":"R2_GET_FAILED";
   }
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
 return state==="R2_WRITE_TEST_OK" || state==="R2_WRITE_READ_OK_HEAD_INCONCLUSIVE"
  ?result(state,200)
  :result(state,503);
}
