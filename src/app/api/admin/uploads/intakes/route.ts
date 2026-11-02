import "server-only";
import {NextRequest} from "next/server";
import {adminConfig,verifiedAdmin} from "@/modules/auth/admin-server";
import {ADMIN_COOKIE,unsealAdminSession} from "@/modules/auth/session";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer",
 "X-Content-Type-Options":"nosniff"};
export async function GET(req:NextRequest){
 const cfg=adminConfig();if(!cfg)return Response.json({error:"UNAVAILABLE"},{status:503,headers});
 const cookie=req.cookies.get(ADMIN_COOKIE)?.value;
 const session=cookie?unsealAdminSession(cookie,cfg.cookieKey):null;
 if(!session)return Response.json({error:"UNAUTHORIZED"},{status:401,headers});
 const admin=await verifiedAdmin(session.accessToken,cfg);
 if(!admin)return Response.json({error:"UNAUTHORIZED"},{status:401,headers});
 const path=new URL("/rest/v1/ipa_upload_intakes",cfg.supabaseUrl);
 path.searchParams.set("select","id,filename,expected_bytes,state,created_at,expires_at,scan_finished_at,scan_error,scan_report,sha256_verified");
 path.searchParams.set("requested_by","eq."+admin.id);
 path.searchParams.set("order","created_at.desc");
 path.searchParams.set("limit","20");
 try{
  const r=await fetch(path,{
   headers:{apikey:cfg.publishableKey,Authorization:"Bearer "+session.accessToken},
   cache:"no-store",signal:AbortSignal.timeout(7000)});
  if(!r.ok)return Response.json({error:"INTAKE_LIST_UNAVAILABLE"},{status:503,headers});
  const records:unknown=await r.json();
  if(!Array.isArray(records))return Response.json({error:"INTAKE_LIST_UNAVAILABLE"},{status:503,headers});
  const items=records.slice(0,20).filter(x=>x&&typeof x==="object"&&
    typeof x.id==="string"&&typeof x.filename==="string"&&
    typeof x.expected_bytes==="number"&&typeof x.state==="string");
  return Response.json({items},{headers});
 }catch{return Response.json({error:"INTAKE_LIST_UNAVAILABLE"},{status:503,headers});}
}
