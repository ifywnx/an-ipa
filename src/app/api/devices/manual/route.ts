import {NextRequest,NextResponse} from "next/server";
import {getManualConfig} from "@/modules/enrollment/manual";
import {customerConfig, customerFromRequest} from "@/modules/auth/customer-server";
import {createAccountDbClient} from "@/modules/accounts/server";
import {attachManualRequest} from "@/modules/accounts/ownership";
import {enrollmentDb,enrollmentHeaders,tokenHash} from "@/modules/enrollment/server";
import {encryptUdid,keyedHash,randomToken} from "@/modules/enrollment/secure";
import {normalizeUdid} from "@/modules/devices/policy";
export const runtime="nodejs";
const cookie="an_manual_udid";
const fail=(error:string,status:number)=>Response.json({error},{status,headers:enrollmentHeaders});
function browserToken(r:NextRequest):string|null{
 const t=r.cookies.get(cookie)?.value;
 return t&&/^[A-Za-z0-9_-]{40,64}$/.test(t)?t:null;
}
export async function POST(r:NextRequest) {
 const cfg=getManualConfig();if(!cfg)return fail("NOT_READY",503);
 if(r.headers.get("origin")!==cfg.appOrigin||
  !r.headers.get("content-type")?.startsWith("application/json"))return fail("BAD_ORIGIN",403);
 const ip=r.headers.get(cfg.trustedIpHeader);
 if(!ip||ip.length>64||!/^[0-9a-f:.]+$/i.test(ip))return fail("TRUSTED_EDGE_REQUIRED",503);
 let body:unknown;
 try {
   if(Number(r.headers.get("content-length")||0)>1500)throw Error("too large");
   const raw=await r.text();if(raw.length>1500)throw Error("too large");
   body=JSON.parse(raw);
 }catch{return fail("BAD_REQUEST",400);}
 if(!body||typeof body!=="object")return fail("BAD_REQUEST",400);
 const input=body as Record<string,unknown>;
 if(input.consent!==true)return fail("CONSENT_REQUIRED",400);
 let udid:string;
 try{if(typeof input.udid!=="string")throw Error("missing");udid=normalizeUdid(input.udid);}
 catch{return fail("INVALID_UDID",400);}
 const label=typeof input.deviceLabel==="string"?input.deviceLabel.trim():"";
 if(label.length>80||/[\u0000-\u001f\u007f]/.test(label))return fail("INVALID_LABEL",400);
 const token=randomToken(),expiry=new Date(Date.now()+30*24*3600*1000);
 try {
   const id=await enrollmentDb<string>(cfg,"rpc/submit_manual_udid_request",{
    method:"POST",body:JSON.stringify({
      p_request_token_hash:tokenHash(token),p_ip_hmac:keyedHash(cfg.encryptionKey,"ip",ip),
      p_udid_ciphertext:encryptUdid(cfg.encryptionKey,udid),
      p_udid_hmac:keyedHash(cfg.encryptionKey,"udid",udid),
      p_udid_suffix:udid.slice(-4),p_device_label:label
    })
   });
   if(typeof id!=="string")return fail("UNAVAILABLE",503);
   // Signed-in submitters get the request linked to their account. Best
   // effort only: ownership bookkeeping must never fail an intake, and a
   // guest submit simply stays unowned (claimable later from this browser).
   const accountCfg=customerConfig();
   if(accountCfg){
     try{
       const account=await customerFromRequest(r);
       if(account)await attachManualRequest(createAccountDbClient(accountCfg),id,account.user.id);
     }catch{/* intake already stored */}
   }
   const response=NextResponse.json({requestId:id,status:"pending_unverified",
     message:"Chờ xác minh, không có quyền OTA."},{status:201,headers:enrollmentHeaders});
   response.cookies.set(cookie,token,{httpOnly:true,secure:true,sameSite:"lax",
     path:"/api/devices/manual",expires:expiry});
   return response;
 }catch{return fail("RATE_LIMITED_OR_DUPLICATE",429);}
}
export async function GET(r:NextRequest){
 const cfg=getManualConfig();if(!cfg)return fail("NOT_READY",503);
 const t=browserToken(r);
 if(!t)return Response.json({status:"not_started"},{headers:enrollmentHeaders});
 try {
   const rows=await enrollmentDb<Array<{id:string;status:string;udid_suffix:string;expires_at:string}>>(
     cfg,"manual_udid_requests?select=id,status,udid_suffix,expires_at&request_token_hash=eq."+
     tokenHash(t)+"&limit=1");
   const row=rows[0];
   if(!row)return Response.json({status:"not_started"},{headers:enrollmentHeaders});
   if(Date.parse(row.expires_at)<=Date.now())return Response.json({status:"expired"},{headers:enrollmentHeaders});
   return Response.json({requestId:row.id,status:row.status,udidSuffix:row.udid_suffix,
     message:"UDID chưa được xác minh hoặc đăng ký với Apple."},{headers:enrollmentHeaders});
 }catch{return fail("UNAVAILABLE",503);}
}
export async function DELETE(r:NextRequest){
 const cfg=getManualConfig();if(!cfg)return fail("NOT_READY",503);
 if(r.headers.get("origin")!==cfg.appOrigin)return fail("BAD_ORIGIN",403);
 const t=browserToken(r);if(!t)return fail("INVALID_SESSION",400);
 try{
   await enrollmentDb<unknown>(cfg,
     "manual_udid_requests?request_token_hash=eq."+tokenHash(t),
     {method:"DELETE",headers:{"Prefer":"return=minimal"}});
   const response=NextResponse.json({deleted:true},{headers:enrollmentHeaders});
   response.cookies.delete(cookie);return response;
 }catch{return fail("DELETE_UNAVAILABLE",503);}
}
