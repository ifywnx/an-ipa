import 'server-only';
import {Sandbox} from '@vercel/sandbox';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {validateR2,type PrivateR2} from '@/modules/ipa/r2-presign';
import {presignWorkerObject,receiptPattern} from './r2-objects';
const files=['ipa_inspector.py','quarantine_worker.py','sandbox_scan.py'];
export function workerConfigured(){return process.env.IPA_VERCEL_WORKER_ENABLED==='true'&&!!process.env.SUPABASE_SECRET_KEY;}
function config(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL||'';
 const secret=process.env.SUPABASE_SECRET_KEY||'';
 const r2:PrivateR2={accountId:process.env.R2_ACCOUNT_ID||'',bucket:process.env.R2_BUCKET||'',accessKeyId:process.env.R2_ACCESS_KEY_ID||'',secretAccessKey:process.env.R2_SECRET_ACCESS_KEY||''};
 if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)||!secret||!validateR2(r2))throw Error('WORKER_CONFIG_MISSING');
 return {url,secret,r2};
}
export async function workerRequest(path:string,body?:unknown,method='POST'){
 const c=config();
 const headers:Record<string,string>={apikey:c.secret,'Content-Type':'application/json','Prefer':'return=representation'};
 if(!c.secret.startsWith('sb_secret_'))headers.Authorization='Bearer '+c.secret;
 const response=await fetch(c.url+'/rest/v1/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!response.ok)throw Error('WORKER_DATABASE_UNAVAILABLE');
 const raw=await response.text();if(raw.length>65536)throw Error('WORKER_DATABASE_RESPONSE_LIMIT');
 return raw?JSON.parse(raw):null;
}
type Claim={id:string;object_key:string;expected_bytes:number;scan_token:string;scan_attempts:number};
async function recordRun(id:string|null,kind:'scan'|'cleanup'|'self_test'){
 const runId=randomUUID();await workerRequest('ipa_worker_runs',{id:runId,intake_id:id,kind,status:'running'});return runId;
}
async function finishRun(id:string,status:'succeeded'|'failed',error:string|null=null){
 await workerRequest('ipa_worker_runs?id=eq.'+id,{status,error_code:error,finished_at:new Date().toISOString()},'PATCH');
}
async function loadSources(tests=false){
 const names=tests?[...files,...(await readdir(process.cwd()+'/workers/tests')).filter(n=>n.endsWith('.py')).map(n=>'tests/'+n)]:files;
 return Promise.all(names.map(async name=>({path:'/vercel/sandbox/'+name,content:await readFile(process.cwd()+'/workers/'+name)})));
}
export async function sandboxSelfTest(){
 const box=await Sandbox.create({persistent:false,resources:{vcpus:1},timeout:180000,ports:[],networkPolicy:'deny-all',tags:{purpose:'ipa-self-test'}});
 try{
  await box.writeFiles(await loadSources(true));
  const result=await box.runCommand({cmd:'python3',args:['-I','-m','unittest','discover','-s','/vercel/sandbox/tests','-v'],cwd:'/vercel/sandbox'});
  if(result.exitCode!==0)throw Error('SANDBOX_SELF_TEST_FAILED');
  return {ok:true,environment:'vercel-sandbox',network:'deny-all',signatureVerified:false,installEligible:false};
 }finally{await box.stop();await box.delete();}
}
function validateResult(raw:string){
 if(raw.length>8192)throw Error('WORKER_REPORT_INVALID');
 const result=JSON.parse(raw);
 if(!['quarantined_unverified','rejected','retry'].includes(result.state))throw Error('WORKER_REPORT_INVALID');
 if(result.state==='quarantined_unverified'){
  if(!/^[a-f0-9]{64}$/.test(result.sha256)||!result.report||result.report.install_eligible!==false||result.report.code_signature_verified!==false||result.report.apple_signer_chain_trusted!==false)throw Error('WORKER_REPORT_INVALID');
  const r=result.report;
  const safe:Record<string,unknown>={};
  for(const key of ['bundle_id','version','build','profile_type','team_id','profile_expires_at']){if(typeof r[key]!=='string'||r[key].length>128)throw Error('WORKER_REPORT_INVALID');safe[key]=r[key];}
  if(!Number.isSafeInteger(r.ad_hoc_device_count)||r.ad_hoc_device_count<0||r.ad_hoc_device_count>100000)throw Error('WORKER_REPORT_INVALID');
  Object.assign(safe,{ad_hoc_device_count:r.ad_hoc_device_count,cms_content_integrity:r.cms_content_integrity===true,code_signature_verified:false,apple_signer_chain_trusted:false,install_eligible:false});
  return {state:result.state as string,sha256:result.sha256 as string,report:safe,error:null};
 }
 if(typeof result.error!=='string'||!/^[A-Z0-9_]{3,60}$/.test(result.error))throw Error('WORKER_REPORT_INVALID');
 return {state:result.state as string,sha256:null,report:null,error:result.error as string};
}
export async function scanReceiptOnce(id:string):Promise<{done:boolean;deleteAfter?:string}>{
 if(!workerConfigured()||!receiptPattern.test(id))throw Error('WORKER_DISABLED');
 await workerRequest('rpc/reap_expired_ipa_scans',{});
 const claims=await workerRequest('rpc/claim_ipa_scan_receipt',{p_id:id}) as Claim[];
 if(!Array.isArray(claims)||claims.length>1)throw Error('WORKER_CLAIM_INVALID');
 if(!claims.length){
  const records=await workerRequest('ipa_upload_intakes?id=eq.'+id+'&select=state,delete_after&limit=1',undefined,'GET');
  const item=records?.[0];
  return {done:!item||['rejected','quarantined_unverified'].includes(item.state),deleteAfter:item?.delete_after};
 }
 const claim=claims[0];
 if(claim.id!==id||claim.object_key!=='quarantine/'+id+'.ipa'||!receiptPattern.test(claim.scan_token)||!Number.isSafeInteger(claim.expected_bytes)||claim.expected_bytes<100||claim.expected_bytes>104857600)throw Error('WORKER_CLAIM_INVALID');
 const runId=await recordRun(id,'scan');
 let result:ReturnType<typeof validateResult>={state:'retry',sha256:null,report:null,error:'SANDBOX_UNAVAILABLE'};
 let box:Sandbox|undefined;
 try{
  const c=config();
  box=await Sandbox.create({persistent:false,resources:{vcpus:1},timeout:210000,ports:[],networkPolicy:{allow:[c.r2.accountId.toLowerCase()+'.r2.cloudflarestorage.com']},tags:{purpose:'ipa-quarantine'}});
  await box.writeFiles([...await loadSources(),{path:'/vercel/sandbox/job.json',content:Buffer.from(JSON.stringify({id,expected_bytes:claim.expected_bytes,url:presignWorkerObject(c.r2,id,'GET')}))}]);
  const command=await box.runCommand({cmd:'python3',args:['-I','-c',"import sys; sys.path.insert(0,'/vercel/sandbox'); from sandbox_scan import main; raise SystemExit(main())"],cwd:'/vercel/sandbox'});
  if(command.exitCode===0)result=validateResult(await command.stdout());
  else result.error='SANDBOX_RESOURCE_LIMIT';
 }catch{/* Never log SDK exception objects, headers or signed URLs. */}
 finally{if(box){try{await box.stop();await box.delete();}catch{/* VM timeout remains the last-resort cleanup. */}}}
 const state=result.state==='retry'?(claim.scan_attempts<3?'uploaded_pending_scan':'rejected'):result.state;
 const finished=await workerRequest('rpc/finish_ipa_scan',{p_id:id,p_token:claim.scan_token,p_state:state,p_sha256:result.sha256,p_report:result.report,p_error:result.error});
 await finishRun(runId,finished===true&&state==='quarantined_unverified'?'succeeded':'failed',finished===true?result.error:'SCAN_LEASE_LOST');
 const records=await workerRequest('ipa_upload_intakes?id=eq.'+id+'&select=delete_after&limit=1',undefined,'GET');
 return {done:finished===true&&state!=='uploaded_pending_scan',deleteAfter:records?.[0]?.delete_after};
}
export async function cleanupReceipt(id:string){
 if(!workerConfigured()||!receiptPattern.test(id))throw Error('WORKER_DISABLED');
 const claims=await workerRequest('rpc/claim_ipa_cleanup',{p_id:id});
 if(!Array.isArray(claims)||claims.length>1)throw Error('CLEANUP_CLAIM_INVALID');
 if(!claims.length){const rows=await workerRequest('ipa_upload_intakes?id=eq.'+id+'&select=object_deleted_at&limit=1',undefined,'GET');return {done:!rows?.length||!!rows[0].object_deleted_at};}
 const claim=claims[0];if(claim.id!==id||claim.object_key!=='quarantine/'+id+'.ipa'||!receiptPattern.test(claim.cleanup_token))throw Error('CLEANUP_CLAIM_INVALID');
 const run=await recordRun(id,'cleanup');let deleted=false;
 try{const response=await fetch(presignWorkerObject(config().r2,id,'DELETE'),{method:'DELETE',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});deleted=response.ok||response.status===404;await response.body?.cancel();}catch{}
 const done=await workerRequest('rpc/finish_ipa_cleanup',{p_id:id,p_token:claim.cleanup_token,p_deleted:deleted,p_error:deleted?null:'R2_DELETE_FAILED'});
 await finishRun(run,deleted&&done===true?'succeeded':'failed',deleted&&done===true?null:'R2_DELETE_FAILED');
 return {done:deleted&&done===true};
}

/** Explicit Preview-only synthetic end-to-end diagnostic, invoked by project operators.
 * Receipt must be created separately; never accepts file content or arbitrary paths.
 */
export async function testSyntheticPipeline(id:string){
 if(process.env.VERCEL_ENV!=='preview'||!workerConfigured()||!receiptPattern.test(id))throw Error('DIAGNOSTIC_DISABLED');
 const rows=await workerRequest('ipa_upload_intakes?id=eq.'+id+'&select=id,filename,expected_bytes,state,created_at&limit=1',undefined,'GET');
 const receipt=rows?.[0];
 if(!receipt||receipt.filename!=='__AN_IPA_SYNTHETIC_DIAGNOSTIC__.ipa'||receipt.expected_bytes!==123||receipt.state!=='reserved'||Date.now()-Date.parse(receipt.created_at)>600000)throw Error('DIAGNOSTIC_RECEIPT_INVALID');
 const {presignPrivateIpaPut}=await import('@/modules/ipa/r2-presign');
 const c=config();
 const grant=presignPrivateIpaPut(c.r2,123,new Date(),id);
 let uploaded=false;
 try{
  const put=await fetch(grant.url,{method:'PUT',headers:grant.headers,body:Buffer.alloc(123,65),redirect:'error',signal:AbortSignal.timeout(15000)});
  uploaded=put.ok;await put.body?.cancel();if(!uploaded)throw Error('DIAGNOSTIC_UPLOAD_FAILED');
  const replay=await fetch(grant.url,{method:'PUT',headers:grant.headers,body:Buffer.alloc(123,66),redirect:'error',signal:AbortSignal.timeout(15000)});
  const replayBlocked=replay.status===412;await replay.body?.cancel();if(!replayBlocked)throw Error('DIAGNOSTIC_OVERWRITE_ACCEPTED');
  await workerRequest('ipa_upload_intakes?id=eq.'+id+'&state=eq.reserved',{state:'uploaded_pending_scan'},'PATCH');
  const scan=await scanReceiptOnce(id);
  const results=await workerRequest('ipa_upload_intakes?id=eq.'+id+'&select=state,signature_trusted,install_eligible,scan_error&limit=1',undefined,'GET');
  const result=results?.[0];
  if(!scan.done||result?.state!=='rejected'||result.signature_trusted!==false||result.install_eligible!==false)throw Error('DIAGNOSTIC_REJECTION_FAILED');
  await workerRequest('ipa_upload_intakes?id=eq.'+id,{delete_after:new Date(Date.now()-1000).toISOString()},'PATCH');
  const cleanup=await cleanupReceipt(id);
  if(!cleanup.done)throw Error('DIAGNOSTIC_CLEANUP_FAILED');
  const probe=await fetch(presignWorkerObject(c.r2,id,'GET'),{redirect:'error',signal:AbortSignal.timeout(15000)});
  const gone=probe.status===404;await probe.body?.cancel();if(!gone)throw Error('DIAGNOSTIC_OBJECT_REMAINS');
  return {synthetic:true,bytes:123,overwriteBlocked:true,scanRejected:true,objectDeleted:true,signatureVerified:false,installEligible:false};
 }finally{
  if(uploaded){try{const r=await fetch(presignWorkerObject(c.r2,id,'DELETE'),{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(15000)});await r.body?.cancel();}catch{}}
 }
}
