import {NextRequest} from "next/server";
import {adminConfig,verifiedAdmin} from "@/modules/auth/admin-server";
import {ADMIN_COOKIE,unsealAdminSession,sameOrigin} from "@/modules/auth/session";
import {MAX_DIRECT_IPA_BYTES,presignPrivateIpaPut,validateR2,type PrivateR2} from "@/modules/ipa/r2-presign";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer"};
const fail=(code:string,status:number)=>Response.json({error:code},{status,headers});
type Intake={id:string;object_key:string;expires_at:string};
/**
 * Real IPA grants stay disabled until WAF, quarantine lifecycle and a trusted
 * scanner are deployed and tested. DB intake reservation is necessary but
 * NOT by itself an authorization to upload, publish or install.
 */
export async function POST(request:NextRequest){
 const cfg=adminConfig();
 if(!cfg||process.env.R2_PRIVATE_UPLOAD_ENABLED!=="true"||
   process.env.R2_PRIVATE_WAF_READY!=="true"||
   process.env.R2_QUARANTINE_LIFECYCLE_READY!=="true"||
   process.env.R2_SCANNER_READY!=="true")return fail("UPLOAD_NOT_READY",503);
 if(!sameOrigin(request.headers.get("origin"),cfg.origin)||
   !request.headers.get("content-type")?.startsWith("application/json"))
   return fail("INVALID_ORIGIN",403);
 const cookie=request.cookies.get(ADMIN_COOKIE)?.value;
 const session=cookie?unsealAdminSession(cookie,cfg.cookieKey):null;
 if(!session)return fail("UNAUTHORIZED",401);
 const admin=await verifiedAdmin(session.accessToken,cfg);
 if(!admin)return fail("UNAUTHORIZED",401);
 let input:unknown;
 try{
  if(Number(request.headers.get("content-length")||0)>1000)return fail("BAD_REQUEST",400);
  const text=await request.text();if(text.length>1000)return fail("BAD_REQUEST",400);
  input=JSON.parse(text);
 }catch{return fail("BAD_REQUEST",400);}
 if(!input||typeof input!=="object")return fail("BAD_REQUEST",400);
 const payload=input as Record<string,unknown>;
 const name=payload.filename,size=payload.size;
 if(typeof name!=="string"||name.length>180||!/^[^/\\]+\.ipa$/i.test(name)||
    /[\x00-\x1f\x7f]/.test(name)||
    typeof size!=="number"||!Number.isSafeInteger(size)||size<100||
    size>MAX_DIRECT_IPA_BYTES)return fail("INVALID_IPA_DETAILS",400);
 const e=process.env;
 const r2:PrivateR2={accountId:e.R2_ACCOUNT_ID||"",bucket:e.R2_BUCKET||"",
    accessKeyId:e.R2_ACCESS_KEY_ID||"",secretAccessKey:e.R2_SECRET_ACCESS_KEY||""};
 if(!validateR2(r2))return fail("STORAGE_NOT_CONFIGURED",503);
 try{
  const response=await fetch(cfg.supabaseUrl+"/rest/v1/rpc/reserve_ipa_intake",{
    method:"POST",headers:{apikey:cfg.publishableKey,
      Authorization:"Bearer "+session.accessToken,"Content-Type":"application/json"},
    body:JSON.stringify({p_filename:name,p_expected_bytes:size}),
    cache:"no-store",signal:AbortSignal.timeout(7000)
  });
  if(!response.ok){
    if(response.status===403)return fail("INTAKE_PERMISSION_DENIED",403);
    let error:unknown=null;
    try{error=await response.json();}catch{/* no logging */}
    if(error&&typeof error==="object"&&(error as {message?:unknown}).message==="IPA_INTAKE_QUOTA")
      return fail("INTAKE_RATE_LIMIT",429);
    return fail("INTAKE_NOT_AVAILABLE",503);
  }
  const raw:unknown=await response.json();
  if(!Array.isArray(raw)||raw.length!==1)return fail("INTAKE_NOT_AVAILABLE",503);
  const intake=raw[0] as Intake;
  if(!intake||typeof intake.id!=="string"||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(intake.id)||
    intake.object_key!=="quarantine/"+intake.id+".ipa")
    return fail("INTAKE_INTEGRITY_FAILURE",503);
  const grant=presignPrivateIpaPut(r2,size,new Date(),intake.id);
  if(grant.objectKey!==intake.object_key)return fail("INTAKE_INTEGRITY_FAILURE",503);
  return Response.json({uploadUrl:grant.url,headers:grant.headers,
    expiresIn:grant.expiresIn,receiptId:intake.id,
    maximumBytes:MAX_DIRECT_IPA_BYTES,
    message:"Đã cấp upload vào vùng cách ly. Chưa xác minh chữ ký hoặc đủ điều kiện cài OTA."},{headers});
 }catch{return fail("INTAKE_NOT_AVAILABLE",503);}
}
