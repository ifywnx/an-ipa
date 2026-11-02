import "server-only";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {ADMIN_COOKIE, readKey,unsealAdminSession} from "./session";

export interface AdminAuthConfig {
 origin:string;supabaseUrl:string;publishableKey:string;secretKey:string;cookieKey:Buffer;
}
export function adminConfig():AdminAuthConfig|null{
 const e=process.env;
 if(e.ADMIN_AUTH_ENABLED!=="true"||e.ADMIN_AUTH_WAF_READY!=="true"||
  !e.APP_ORIGIN||!e.NEXT_PUBLIC_SUPABASE_URL||
  !e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||!e.SUPABASE_SECRET_KEY||
  !e.ADMIN_SESSION_KEY_B64)return null;
 try{
  const origin=new URL(e.APP_ORIGIN),db=new URL(e.NEXT_PUBLIC_SUPABASE_URL);
  if(origin.origin!==e.APP_ORIGIN||db.origin!==e.NEXT_PUBLIC_SUPABASE_URL||
    origin.protocol!=="https:"||db.protocol!=="https:"||
    origin.username||origin.password||db.username||db.password)return null;
  const key=readKey(e.ADMIN_SESSION_KEY_B64);
  return {origin:origin.origin,supabaseUrl:db.origin,
    publishableKey:e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secretKey:e.SUPABASE_SECRET_KEY,cookieKey:key};
 }catch{return null;}
}
type AuthUser = {id?:unknown;email?:unknown;email_confirmed_at?:unknown;banned_until?:unknown};
export function validUser(value:unknown):value is {id:string;email:string;email_confirmed_at:string}{
 if(!value||typeof value!=="object")return false;
 const v=value as AuthUser;
 return typeof v.id==="string"&&/^[0-9a-f-]{36}$/.test(v.id)&&
  typeof v.email==="string"&&!!v.email&&
  typeof v.email_confirmed_at==="string"&&!!v.email_confirmed_at&&
  !(typeof v.banned_until==="string"&&Date.parse(v.banned_until)>Date.now());
}
async function safeJson(response:Response):Promise<unknown>{
 if(!response.ok)return null;
 const size=response.headers.get("content-length");
 if(size&&Number(size)>16384)return null;
 try{return await response.json() as unknown;}catch{return null;}
}
export async function verifiedAdmin(accessToken:string,cfg:AdminAuthConfig,
 transport:typeof fetch=fetch):Promise<{id:string;email:string}|null>{
 if(!accessToken||accessToken.length>2400)return null;
 try {
  const userResponse=await transport(cfg.supabaseUrl+"/auth/v1/user",{
    method:"GET",headers:{apikey:cfg.publishableKey,Authorization:"Bearer "+accessToken},
    signal:AbortSignal.timeout(7000),cache:"no-store"
  });
  const u=await safeJson(userResponse);
  if(!validUser(u))return null;
  const url=new URL("/rest/v1/roles",cfg.supabaseUrl);
  url.searchParams.set("select","role");
  url.searchParams.set("user_id","eq."+u.id);
  url.searchParams.set("role","eq.admin");
  url.searchParams.set("limit","1");
  const authHeaders:Record<string,string>={apikey:cfg.secretKey};
  if(!cfg.secretKey.startsWith("sb_secret_"))
    authHeaders.Authorization="Bearer "+cfg.secretKey;
  const roleResponse=await transport(url.toString(),{
    headers:authHeaders,signal:AbortSignal.timeout(7000),cache:"no-store"
  });
  const rows=await safeJson(roleResponse);
  if(!Array.isArray(rows)||rows.length!==1||!rows[0]||
    typeof rows[0]!=="object"||(rows[0] as {role?:unknown}).role!=="admin")return null;
  return {id:u.id,email:u.email};
 }catch{return null;}
}
export async function adminFromSession():Promise<{id:string;email:string}|null>{
 const cfg=adminConfig();if(!cfg)return null;
 const sealed=(await cookies()).get(ADMIN_COOKIE)?.value;
 if(!sealed)return null;
 const token=unsealAdminSession(sealed,cfg.cookieKey);
 if(!token)return null;
 return await verifiedAdmin(token.accessToken,cfg);
}
export async function requireAdmin(){
 const account=await adminFromSession();
 if(!account)redirect("/auth?reason=admin");
 return account;
}
