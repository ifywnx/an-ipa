import {createHash,createHmac} from 'node:crypto';
import {validateR2,type PrivateR2} from '@/modules/ipa/r2-presign';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const hmac=(k:string|Buffer,s:string)=>createHmac('sha256',k).update(s).digest();
const enc=(s:string)=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export const receiptPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Read/delete only ONE server-reserved quarantine object. Never an install link. */
export function presignWorkerObject(config:PrivateR2,id:string,method:'GET'|'DELETE',now=new Date()){
 if(!validateR2(config)||!receiptPattern.test(id)||!Number.isFinite(now.getTime()))throw Error('INVALID_WORKER_GRANT');
 const host=config.accountId.toLowerCase()+'.r2.cloudflarestorage.com';
 const path='/'+enc(config.bucket)+'/quarantine/'+id+'.ipa';
 const stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,'');const day=stamp.slice(0,8),scope=day+'/auto/s3/aws4_request';
 const fields={'X-Amz-Algorithm':'AWS4-HMAC-SHA256','X-Amz-Content-Sha256':'UNSIGNED-PAYLOAD','X-Amz-Credential':config.accessKeyId+'/'+scope,'X-Amz-Date':stamp,'X-Amz-Expires':'240','X-Amz-SignedHeaders':'host'};
 const query=Object.entries(fields).map(([k,v])=>enc(k)+'='+enc(v)).sort().join('&');
 const canonical=[method,path,query,'host:'+host+'\n','host','UNSIGNED-PAYLOAD'].join('\n');
 const key=hmac(hmac(hmac(hmac('AWS4'+config.secretAccessKey,day),'auto'),'s3'),'aws4_request');
 const sig=createHmac('sha256',key).update(['AWS4-HMAC-SHA256',stamp,scope,hash(canonical)].join('\n')).digest('hex');
 return 'https://'+host+path+'?'+query+'&X-Amz-Signature='+sig;
}

/** Read-only bucket management uses header auth: R2 presigning supports object APIs. */
export function signLifecycleRead(config:PrivateR2,now=new Date()){
 if(!validateR2(config)||!Number.isFinite(now.getTime()))throw Error('INVALID_WORKER_GRANT');
 const host=config.accountId.toLowerCase()+'.r2.cloudflarestorage.com';
 const path='/'+enc(config.bucket),stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,''),day=stamp.slice(0,8),scope=day+'/auto/s3/aws4_request';
 const digest=hash(''),signed='host;x-amz-content-sha256;x-amz-date';
 const canonical=['GET',path,'lifecycle=','host:'+host+'\nx-amz-content-sha256:'+digest+'\nx-amz-date:'+stamp+'\n',signed,digest].join('\n');
 const key=hmac(hmac(hmac(hmac('AWS4'+config.secretAccessKey,day),'auto'),'s3'),'aws4_request');
 const sig=createHmac('sha256',key).update(['AWS4-HMAC-SHA256',stamp,scope,hash(canonical)].join('\n')).digest('hex');
 return {url:'https://'+host+path+'?lifecycle=',headers:{Authorization:'AWS4-HMAC-SHA256 Credential='+config.accessKeyId+'/'+scope+', SignedHeaders='+signed+', Signature='+sig,'x-amz-date':stamp,'x-amz-content-sha256':digest}};
}
