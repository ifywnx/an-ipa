// Uses the existing Vercel CLI login through the official Workflow CLI adapter.
// No API keys, IPA, UDID or signed object URL is sent to this script.
import {setupCliWorld} from '../node_modules/@workflow/cli/dist/lib/inspect/setup.js';
import {start} from '@workflow/core/runtime';
import {healthCheck} from '@workflow/core/runtime/helpers';
import {readFile} from 'node:fs/promises';
const deploymentId=process.argv[2];
if(!/^dpl_[A-Za-z0-9]+$/.test(deploymentId||''))throw Error('Pass the reviewed Preview deployment ID');
const world=await setupCliWorld({backend:'vercel',env:'preview',project:'prj_xTem7FNqAHhpHpiEhVe5qv9in6EL',team:'team_0RXiQnJ9tD3DZBTSLMAiFShM',json:true},'5.3.0');
try{
 const health=await healthCheck(world,{deploymentId,timeout:10000});
 if(!health.healthy)throw Error('PREVIEW_WORKFLOW_NOT_READY');
 const name=process.argv[3]?'testQuarantinePipeline':'testWorkerRuntime';
 const manifest=JSON.parse(await readFile('.next/diagnostics/workflows-manifest.json','utf8'));
 const workflowId=manifest.workflows['src/workflows/ipa.ts'][name].workflowId;
 const run=await start({workflowId},process.argv[3]?[process.argv[3]]:[],{deploymentId});
 console.log(JSON.stringify({runId:run.runId,deploymentId}));
 let terminal=false;
 for(let i=0;i<12;i++){
  const status=await run.status;
  if(status==='completed'){terminal=true;console.log(JSON.stringify({status,result:await run.returnValue}));break;}
  if(status==='failed'||status==='cancelled'){terminal=true;console.log(JSON.stringify({status}));process.exitCode=1;break;}
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 if(!terminal){console.log(JSON.stringify({status:'still-running',runId:run.runId}));process.exitCode=2;}
}finally{await world?.close?.();}
