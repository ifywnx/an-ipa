import "server-only";
import {timingSafeEqual} from "node:crypto";
import {enrollmentDb,enrollmentHeaders} from "@/modules/enrollment/server";
import {NextRequest} from "next/server";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const unavailable=()=>Response.json({error:"MAINTENANCE_NOT_CONFIGURED"},
  {status:503,headers:enrollmentHeaders});
export async function POST(request:NextRequest){
  const expected=process.env.MAINTENANCE_CRON_SECRET;
  const serviceKey=process.env.SUPABASE_SECRET_KEY;
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  if(process.env.MAINTENANCE_ENABLED!=="true" || !expected || expected.length<40 ||
    !serviceKey || !url) return unavailable();
  const actual=request.headers.get("authorization")||"";
  const expectedHeader="Bearer "+expected;
  const a=Buffer.from(actual), b=Buffer.from(expectedHeader);
  if(a.length!==b.length || !timingSafeEqual(a,b))
    return Response.json({error:"UNAUTHORIZED"},{status:401,headers:enrollmentHeaders});
  try{
    const supabase=new URL(url);
    if(supabase.protocol!=="https:" || supabase.username || supabase.password ||
      supabase.origin!==url) return unavailable();
    const result=await enrollmentDb<{guest_expired:number;manual_expired:number}>(
      {supabaseUrl:url,serviceKey},"rpc/purge_expired_device_intake",
      {method:"POST",body:"{}"});
    return Response.json({ok:true,deleted:result},{headers:enrollmentHeaders});
  }catch{
    return Response.json({error:"MAINTENANCE_UNAVAILABLE"},{status:503,headers:enrollmentHeaders});
  }
}
