import {NextRequest} from 'next/server';
import {start,getRun} from 'workflow/api';
import {HookConflictError} from 'workflow/errors';
import {adminConfig,verifiedAdmin} from '@/modules/auth/admin-server';
import {ADMIN_COOKIE,unsealAdminSession,sameOrigin} from '@/modules/auth/session';
import {testWorkerRuntime} from '@/workflows/ipa';
import {workerConfigured,workerRequest} from '@/modules/worker/server';
import {enqueueReceipt} from '@/modules/worker/enqueue';
import {receiptPattern} from '@/modules/worker/r2-objects';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer'};
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers});
async function admin(req:NextRequest){const cfg=adminConfig();if(!cfg)return null;const cookie=req.cookies.get(ADMIN_COOKIE)?.value;const session=cookie?unsealAdminSession(cookie,cfg.cookieKey):null;if(!session)return null;const user=await verifiedAdmin(session.accessToken,cfg);return user?{user,cfg,session}:null;}
export async function POST(req:NextRequest){
 const a=await admin(req);if(!a)return respond({error:'UNAUTHORIZED'},401);
 if(!sameOrigin(req.headers.get('origin'),a.cfg.origin)||!req.headers.get('content-type')?.startsWith('application/json'))return respond({error:'INVALID_ORIGIN'},403);
 if(process.env.VERCEL_ENV!=='preview')return respond({error:'PREVIEW_ONLY'},403);
 try{
  const raw=await req.text();if(raw.length>512)return respond({error:'BAD_REQUEST'},400);
  const body=JSON.parse(raw);
  if(body.action==='self-test'){
   try{const run=await start(testWorkerRuntime,[],{hook:{token:'ipa-self-test:'+a.user.id+':'+Math.floor(Date.now()/300000),experimental_minRetention:'1 hour'}});return respond({runId:run.runId},202);}
   catch(error){if(HookConflictError.is(error))return respond({runId:error.conflictingRunId},202);throw error;}
  }
  if(body.action==='retry'&&typeof body.receiptId==='string'&&receiptPattern.test(body.receiptId)){
   if(!workerConfigured())return respond({error:'WORKER_NOT_CONFIGURED'},503);
   // Service role never authorizes an arbitrary receipt: verify ownership with user JWT first.
   const r=await fetch(a.cfg.supabaseUrl+'/rest/v1/ipa_upload_intakes?id=eq.'+body.receiptId+'&requested_by=eq.'+a.user.id+'&select=id&limit=1',{headers:{apikey:a.cfg.publishableKey,Authorization:'Bearer '+a.session.accessToken},cache:'no-store',signal:AbortSignal.timeout(7000)});
   const items=r.ok?await r.json():[];if(!Array.isArray(items)||items.length!==1)return respond({error:'NOT_FOUND'},404);
   return respond({runId:await enqueueReceipt(body.receiptId)},202);
  }
  return respond({error:'BAD_REQUEST'},400);
 }catch{return respond({error:'WORKER_CONTROL_UNAVAILABLE'},503);}
}
export async function GET(req:NextRequest){
 const a=await admin(req);if(!a)return respond({error:'UNAUTHORIZED'},401);
 const runId=req.nextUrl.searchParams.get('runId');
 try{
  if(runId){if(!/^[A-Za-z0-9_-]{10,160}$/.test(runId))return respond({error:'BAD_REQUEST'},400);const run=getRun(runId);return respond({status:await run.status});}
  if(!workerConfigured())return respond({configured:false,runs:[],alerts:['WORKER_NOT_CONFIGURED']});
  const runs=await workerRequest('ipa_worker_runs?select=id,kind,status,error_code,started_at,finished_at&order=started_at.desc&limit=20',undefined,'GET');
  return respond({configured:true,runs,alerts:runs.some((r:{status:string;started_at:string})=>r.status==='failed'||r.status==='running'&&Date.now()-Date.parse(r.started_at)>300000)?['WORKER_ATTENTION_REQUIRED']:[],signatureVerified:false,installEligible:false});
 }catch{return respond({error:'WORKER_HEALTH_UNAVAILABLE'},503);}
}
