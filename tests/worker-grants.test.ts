import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presignWorkerObject} from '../src/modules/worker/r2-objects';
const cfg={accountId:'a'.repeat(32),bucket:'test-quarantine',accessKeyId:'TESTACCESSKEY',secretAccessKey:'SYNTHETIC_SECRET_DO_NOT_USE'};
const id='00000000-0000-4000-8000-000000000001';
const now=new Date('2026-11-03T00:00:00Z');
test('worker grants are short lived and bind the exact object and HTTP method',()=>{
 const read=new URL(presignWorkerObject(cfg,id,'GET',now));
 const remove=new URL(presignWorkerObject(cfg,id,'DELETE',now));
 assert.equal(read.pathname,'/test-quarantine/quarantine/'+id+'.ipa');
 assert.equal(read.searchParams.get('X-Amz-Expires'),'240');
 assert.notEqual(read.searchParams.get('X-Amz-Signature'),remove.searchParams.get('X-Amz-Signature'));
 assert.ok(!read.href.includes(cfg.secretAccessKey));
 assert.notEqual(read.href,presignWorkerObject(cfg,id.replace(/1$/,'2'),'GET',now));
});
test('worker grant refuses path injection and invalid account/bucket/date',()=>{
 for(const bad of ['../secret','quarantine/file.ipa',id+'/other'])assert.throws(()=>presignWorkerObject(cfg,bad,'GET',now));
 assert.throws(()=>presignWorkerObject({...cfg,accountId:'attacker.example'},id,'GET',now));
 assert.throws(()=>presignWorkerObject({...cfg,bucket:'../elsewhere'},id,'GET',now));
 assert.throws(()=>presignWorkerObject(cfg,id,'GET',new Date(NaN)));
});
