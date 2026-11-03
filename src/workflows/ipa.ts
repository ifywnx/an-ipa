import {sleep} from 'workflow';
// Durable inputs contain only the receipt UUID. Secrets remain in step runtime env.
export async function processIpaReceipt(id:string){
 'use workflow';
 let deletion:string|undefined;
 for(let attempt=0;attempt<4;attempt++){
  const result=await inspectReceipt(id);
  deletion=result.deleteAfter;
  if(result.done)break;
  // Covers expired leases when the previous invocation or microVM crashed.
  await sleep('16 minutes');
 }
 if(deletion){
  await sleep(new Date(deletion));
  for(let attempt=0;attempt<3;attempt++){
   const result=await deleteExpiredReceipt(id);
   if(result.done)break;
   await sleep('1 day');
  }
 }
 return {installEligible:false};
}
async function inspectReceipt(id:string){
 'use step';
 const {scanReceiptOnce}=await import('@/modules/worker/server');
 return scanReceiptOnce(id);
}
async function deleteExpiredReceipt(id:string){
 'use step';
 const {cleanupReceipt}=await import('@/modules/worker/server');
 return cleanupReceipt(id);
}
export async function testWorkerRuntime(){
 'use workflow';
 return await testRuntime();
}
async function testRuntime(){
 'use step';
 const {sandboxSelfTest}=await import('@/modules/worker/server');
 return sandboxSelfTest();
}

export async function testQuarantinePipeline(id:string){
 'use workflow';
 return await testSynthetic(id);
}
async function testSynthetic(id:string){
 'use step';
 const {testSyntheticPipeline}=await import('@/modules/worker/server');
 return testSyntheticPipeline(id);
}
// Synthetic diagnostic side effects are not automatically retried. Create a new
// marked receipt for a new diagnostic; normal scans retain their leased retries.
testSynthetic.maxRetries=0;
