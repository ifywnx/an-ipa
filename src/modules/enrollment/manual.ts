import "server-only";
import {keyFromBase64} from "./secure";
export interface ManualConfig {
 appOrigin:string;supabaseUrl:string;serviceKey:string;encryptionKey:Buffer;trustedIpHeader:string;
}
export function getManualConfig():ManualConfig|null {
 const e=process.env;
 if(e.MANUAL_UDID_ENABLED!=="true"||e.MANUAL_UDID_WAF_READY!=="true"||
 !e.APP_ORIGIN||!e.NEXT_PUBLIC_SUPABASE_URL||!e.SUPABASE_SECRET_KEY||
 !e.ENROLLMENT_UDID_ENCRYPTION_KEY_B64||!e.ENROLLMENT_TRUSTED_IP_HEADER) return null;
 try{
  const app=new URL(e.APP_ORIGIN),db=new URL(e.NEXT_PUBLIC_SUPABASE_URL);
  if(app.protocol!=="https:"||db.protocol!=="https:"||
     app.origin!==e.APP_ORIGIN||db.origin!==e.NEXT_PUBLIC_SUPABASE_URL||
     app.username||app.password||db.username||db.password) return null;
  if(!/^[a-z0-9-]{4,70}$/i.test(e.ENROLLMENT_TRUSTED_IP_HEADER)) return null;
  return {appOrigin:app.origin,supabaseUrl:db.origin,serviceKey:e.SUPABASE_SECRET_KEY,
    trustedIpHeader:e.ENROLLMENT_TRUSTED_IP_HEADER.toLowerCase(),
    encryptionKey:keyFromBase64(e.ENROLLMENT_UDID_ENCRYPTION_KEY_B64)};
 }catch{return null;}
}
