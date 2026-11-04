import {Sandbox} from '@vercel/sandbox';
import {readFile,readdir} from 'node:fs/promises';
const box=await Sandbox.create({persistent:false,resources:{vcpus:1},timeout:180000,ports:[],networkPolicy:'deny-all',tags:{purpose:'ipa-self-test'}});
try {
 const names=['ipa_inspector.py','quarantine_worker.py','sandbox_scan.py',...(await readdir('workers/tests')).filter(n=>n.endsWith('.py')).map(n=>'tests/'+n)];
 await box.writeFiles(await Promise.all(names.map(async n=>({path:'/vercel/sandbox/'+n,content:await readFile('workers/'+n)}))));
 const result=await box.runCommand({cmd:'python3',args:['-I','-m','unittest','discover','-s','/vercel/sandbox/tests','-v'],cwd:'/vercel/sandbox'});
 const logs=(await result.stdout())+(await result.stderr());
 console.log(JSON.stringify({sandbox:box.name,exitCode:result.exitCode,tests:logs.match(/Ran \d+ tests[^\n]*/)?.[0],passed:result.exitCode===0}));
 if(result.exitCode!==0){console.log(logs.slice(-8000));process.exitCode=1;}
}finally{await box.stop();await box.delete();}
