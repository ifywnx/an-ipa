import {NextRequest,NextResponse} from "next/server";
import {adminConfig,verifiedAdmin} from "@/modules/auth/admin-server";
import {sameOrigin,sealAdminSession,ADMIN_COOKIE,MAX_ADMIN_SESSION_SECONDS} from "@/modules/auth/session";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store","Referrer-Policy":"no-referrer"};
const reject=(status=401)=>NextResponse.json({ok:false,message:"Đăng nhập không thành công hoặc tài khoản không có quyền Admin."},{status,headers});
export async function POST(request:NextRequest){
 const cfg=adminConfig();if(!cfg)return reject(503);
 if(!sameOrigin(request.headers.get("origin"),cfg.origin)||
  !request.headers.get("content-type")?.startsWith("application/json"))return reject(403);
 if(Number(request.headers.get("content-length")||0)>4096)return reject(413);
 let input:unknown;
 try{
  const text=await request.text();if(text.length>4096)return reject(413);
  input=JSON.parse(text);
 }catch{return reject(400);}
 if(!input||typeof input!=="object")return reject(400);
 const v=input as Record<string,unknown>;
 if(typeof v.email!=="string"||typeof v.password!=="string"||
   !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)||v.email.length>254||
   v.password.length<8||v.password.length>256)return reject(400);
 try{
  const response=await fetch(cfg.supabaseUrl+"/auth/v1/token?grant_type=password",{
    method:"POST",headers:{apikey:cfg.publishableKey,"Content-Type":"application/json"},
    body:JSON.stringify({email:v.email,password:v.password}),
    signal:AbortSignal.timeout(8000),cache:"no-store"
  });
  if(!response.ok)return reject();
  const json:unknown=await response.json();
  if(!json||typeof json!=="object")return reject();
  const tokens=json as {access_token?:unknown;expires_in?:unknown};
  if(typeof tokens.access_token!=="string"||typeof tokens.expires_in!=="number"||
    tokens.expires_in<120)return reject();
  const admin=await verifiedAdmin(tokens.access_token,cfg);
  if(!admin)return reject();
  const ttl=Math.min(MAX_ADMIN_SESSION_SECONDS,Math.floor(tokens.expires_in)-30);
  if(ttl<60)return reject();
  const cookie=sealAdminSession(
    {accessToken:tokens.access_token,expiresAt:Date.now()+ttl*1000},cfg.cookieKey);
  const result=NextResponse.json({ok:true},{headers});
  result.cookies.set(ADMIN_COOKIE,cookie,{
    httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:ttl
  });
  return result;
 }catch{return reject(503);}
}
