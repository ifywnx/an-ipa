import "server-only";
import {NextRequest} from "next/server";
import {adminConfig,verifiedAdmin} from "@/modules/auth/admin-server";
import {ADMIN_COOKIE,unsealAdminSession,sameOrigin} from "@/modules/auth/session";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer"};
const fail=(code:string,status:number)=>Response.json({error:code},{status,headers});
export async function POST(request:NextRequest){
 const cfg=adminConfig();
 // A browser acknowledgement is NOT proof that R2 contains a valid IPA.
 if(!cfg||process.env.R2_PRIVATE_UPLOAD_ENABLED!=="true"||
   process.env.R2_PRIVATE_WAF_READY!=="true"||
   process.env.R2_QUARANTINE_LIFECYCLE_READY!=="true"||
   process.env.R2_SCANNER_READY!=="true")return fail("UPLOAD_NOT_READY",503);
 if(!sameOrigin(request.headers.get("origin"),cfg.origin)||
   !request.headers.get("content-type")?.startsWith("application/json"))
   return fail("INVALID_ORIGIN",403);
 const sealed=request.cookies.get(ADMIN_COOKIE)?.value;
 const session=sealed?unsealAdminSession(sealed,cfg.cookieKey):null;
 if(!session||!await verifiedAdmin(session.accessToken,cfg))return fail("UNAUTHORIZED",401);
 let input:unknown;
 try{
  if(Number(request.headers.get("content-length")||0)>512)return fail("BAD_REQUEST",400);
  const raw=await request.text();if(raw.length>512)return fail("BAD_REQUEST",400);
  input=JSON.parse(raw);
 }catch{return fail("BAD_REQUEST",400);}
 if(!input||typeof input!=="object")return fail("BAD_REQUEST",400);
 const receiptId=(input as Record<string,unknown>).receiptId;
 if(typeof receiptId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receiptId))
  return fail("INVALID_RECEIPT",400);
 try{
  const response=await fetch(cfg.supabaseUrl+"/rest/v1/rpc/ack_ipa_upload",{
   method:"POST",headers:{apikey:cfg.publishableKey,
     Authorization:"Bearer "+session.accessToken,
     "Content-Type":"application/json"},
   body:JSON.stringify({p_receipt:receiptId}),
   cache:"no-store",signal:AbortSignal.timeout(7000)
  });
  if(!response.ok)return fail("INTAKE_ACK_UNAVAILABLE",503);
  const result:unknown=await response.json();
  if(result!==true)return fail("INTAKE_NOT_FOUND_OR_EXPIRED",409);
  return Response.json({ok:true,state:"uploaded_pending_scan",
    message:"Lượt upload đã ghi nhận. Worker sẽ kiểm tra file thực tế; chưa được cấp OTA."},{headers});
 }catch{return fail("INTAKE_ACK_UNAVAILABLE",503);}
}
