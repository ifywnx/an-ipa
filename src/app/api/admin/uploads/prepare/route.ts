import {NextRequest} from "next/server";
import {adminConfig,verifiedAdmin} from "@/modules/auth/admin-server";
import {ADMIN_COOKIE,unsealAdminSession,sameOrigin} from "@/modules/auth/session";
import {MAX_DIRECT_IPA_BYTES,presignPrivateIpaPut} from "@/modules/ipa/r2-presign";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store","Referrer-Policy":"no-referrer"};
const fail=(code:string,status:number)=>Response.json({error:code},{status,headers});
export async function POST(request:NextRequest) {
 const cfg=adminConfig();
 if(!cfg||process.env.R2_PRIVATE_UPLOAD_ENABLED!=="true"||
   process.env.R2_PRIVATE_WAF_READY!=="true"||
   process.env.R2_QUARANTINE_LIFECYCLE_READY!=="true"||
   process.env.R2_SCANNER_READY!=="true") return fail("UPLOAD_NOT_READY",503);
 if(!sameOrigin(request.headers.get("origin"),cfg.origin)||
   !request.headers.get("content-type")?.startsWith("application/json")) return fail("INVALID_ORIGIN",403);
 const cookie=request.cookies.get(ADMIN_COOKIE)?.value;
 const session=cookie?unsealAdminSession(cookie,cfg.cookieKey):null;
 if(!session||!await verifiedAdmin(session.accessToken,cfg))return fail("UNAUTHORIZED",401);
 let body:unknown;
 try{
  if(Number(request.headers.get("content-length")||0)>1000)return fail("BAD_REQUEST",400);
  const raw=await request.text();if(raw.length>1000)return fail("BAD_REQUEST",400);
  body=JSON.parse(raw);
 }catch{return fail("BAD_REQUEST",400);}
 if(!body||typeof body!=="object")return fail("BAD_REQUEST",400);
 const payload=body as Record<string,unknown>;
 const name=payload.filename,size=payload.size;
 if(typeof name!=="string"||name.length>180||!/^[^/\\]+\.ipa$/i.test(name)||
   typeof size!=="number"||!Number.isSafeInteger(size)||size<100||
   size>MAX_DIRECT_IPA_BYTES)return fail("INVALID_IPA_DETAILS",400);
 const env=process.env;
 try{
  const grant=presignPrivateIpaPut({
    accountId:env.R2_ACCOUNT_ID||"",bucket:env.R2_BUCKET||"",
    accessKeyId:env.R2_ACCESS_KEY_ID||"",secretAccessKey:env.R2_SECRET_ACCESS_KEY||""
  },size);
  // The grant is for one private PUT only. This response does not assert
  // that a file was received, parsed, signed correctly or installable.
  return Response.json({uploadUrl:grant.url,headers:grant.headers,expiresIn:grant.expiresIn,
    maximumBytes:MAX_DIRECT_IPA_BYTES,
    message:"Chỉ lưu file vào kho cách ly. Chưa được phép xuất bản."},{headers});
 }catch{return fail("STORAGE_NOT_CONFIGURED",503);}
}
