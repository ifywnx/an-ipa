import {createCipheriv, createDecipheriv,randomBytes,timingSafeEqual} from "node:crypto";

export const ADMIN_COOKIE="__Host-an-admin";
export const MAX_ADMIN_SESSION_SECONDS=45*60;
export interface AdminSession {accessToken:string;expiresAt:number}
export function readKey(base64:string):Buffer{
 const key=Buffer.from(base64,"base64");
 if(key.length!==32)throw Error("Invalid admin session encryption key");
 return key;
}
export function sealAdminSession(session:AdminSession,key:Buffer):string{
 if(!Number.isFinite(session.expiresAt)||!session.accessToken||session.accessToken.length>2400)
   throw Error("Invalid admin session");
 const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify(session),"utf8"),cipher.final()]);
 return [iv,cipher.getAuthTag(),ciphertext].map(v=>v.toString("base64url")).join(".");
}
export function unsealAdminSession(value:string,key:Buffer,now=Date.now()):AdminSession|null{
 try {
  if(!value||value.length>3800)return null;
  const parts=value.split(".");if(parts.length!==3)return null;
  const [iv,tag,ciphertext]=parts.map(p=>Buffer.from(p,"base64url"));
  if(iv.length!==12||tag.length!==16)return null;
  const decipher=createDecipheriv("aes-256-gcm",key,iv);decipher.setAuthTag(tag);
  const plain=Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString("utf8");
  const session:unknown=JSON.parse(plain);
  if(!session||typeof session!=="object")return null;
  const data=session as Record<string,unknown>;
  if(typeof data.accessToken!=="string"||data.accessToken.length<20||data.accessToken.length>2400||
    typeof data.expiresAt!=="number"||data.expiresAt<=now||data.expiresAt>now+MAX_ADMIN_SESSION_SECONDS*1000)
    return null;
  return {accessToken:data.accessToken,expiresAt:data.expiresAt};
 }catch{return null;}
}
export function sameOrigin(origin:string|null,expected:string):boolean{
 return !!origin && origin===expected;
}
export function constantTimeBearer(presented:string,secret:string):boolean{
 if(!secret||secret.length<40)return false;
 const a=Buffer.from(presented),b=Buffer.from("Bearer "+secret);
 return a.length===b.length&&timingSafeEqual(a,b);
}
