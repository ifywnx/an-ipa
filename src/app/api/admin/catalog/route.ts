import 'server-only';
import {NextRequest} from 'next/server';
import {adminConfig,verifiedAdmin} from '@/modules/auth/admin-server';
import {ADMIN_COOKIE,unsealAdminSession,sameOrigin} from '@/modules/auth/session';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const respond=(value:unknown,status=200)=>Response.json(value,{status,headers});
async function handle(req:NextRequest,mutation:boolean){
 const cfg=adminConfig();if(!cfg)return respond({error:'UNAVAILABLE'},503);
 if(mutation&&(!sameOrigin(req.headers.get('origin'),cfg.origin)||!req.headers.get('content-type')?.startsWith('application/json')))return respond({error:'INVALID_ORIGIN'},403);
 const sealed=req.cookies.get(ADMIN_COOKIE)?.value;
 const session=sealed?unsealAdminSession(sealed,cfg.cookieKey):null;
 if(!session||!await verifiedAdmin(session.accessToken,cfg))return respond({error:'UNAUTHORIZED'},401);
 try{
  let action=req.nextUrl.searchParams.get('history')==='true'?'history':'list',data:unknown={};
  if(mutation){
   const reader=req.body?.getReader();if(!reader)return respond({error:'BAD_REQUEST'},400);
   const chunks:Uint8Array[]=[];let size=0;
   while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>20000){await reader.cancel();return respond({error:'REQUEST_TOO_LARGE'},413);}chunks.push(next.value);}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!['save','hide'].includes(body.action)||!body.data||typeof body.data!=='object')return respond({error:'BAD_REQUEST'},400);
   action=body.action;data=body.data;
  }
  const r=await fetch(cfg.supabaseUrl+'/rest/v1/rpc/admin_catalog',{method:'POST',headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+session.accessToken,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_data:data}),cache:'no-store',signal:AbortSignal.timeout(7000)});
  if(!r.ok){const error=await r.json();const code=error?.code;return respond({error:code==='40001'?'APP_CHANGED':code==='23505'?'SLUG_EXISTS':code==='P0001'?'RATE_LIMITED':'CATALOG_REQUEST_FAILED'},code==='40001'||code==='23505'?409:code==='P0001'?429:400);}
  return respond({data:await r.json()});
 }catch{return respond({error:'CATALOG_UNAVAILABLE'},503);}
}
export async function GET(req:NextRequest){return handle(req,false);}
export async function POST(req:NextRequest){return handle(req,true);}
