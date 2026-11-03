import 'server-only';
import {start,getRun} from 'workflow/api';
import {HookConflictError} from 'workflow/errors';
import {processIpaReceipt} from '@/workflows/ipa';
export async function enqueueReceipt(id:string){
 let token='ipa-receipt:'+id;
 // Concurrent requests converge on the same run. A failed durable run can be
 // recovered without resetting the database scan budget or replacing live work.
 for(let recovery=0;recovery<4;recovery++){
  try{const run=await start(processIpaReceipt,[id],{hook:{token,experimental_minRetention:'30 days'}});return run.runId;}
  catch(error){
   if(!HookConflictError.is(error)||!error.conflictingRunId)throw Error('WORKER_QUEUE_UNAVAILABLE');
   const previous=getRun(error.conflictingRunId);
   const status=await previous.status;
   if(status!=='failed'&&status!=='cancelled')return error.conflictingRunId;
   token='ipa-recovery:'+error.conflictingRunId;
  }
 }
 throw Error('WORKER_RECOVERY_LIMIT');
}
