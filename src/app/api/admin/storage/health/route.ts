import "server-only";
import {adminFromSession} from "@/modules/auth/admin-server";
import {presignPrivateR2HeadBucket,validateR2,type PrivateR2} from "@/modules/ipa/r2-presign";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store, private","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const result=(state:string,status:number)=>Response.json({state},{status,headers});
export async function GET(){
  const admin=await adminFromSession();
  if(!admin)return result("UNAUTHORIZED",401);
  // Never query R2 from production or when Admin Preview diagnostics is disabled.
  if(process.env.VERCEL_ENV!=="preview"||process.env.R2_STORAGE_DIAGNOSTICS_ENABLED!=="true")
    return result("CHECK_NOT_ENABLED",503);
  const e=process.env;
  const cfg:PrivateR2={
    accountId:e.R2_ACCOUNT_ID||"",bucket:e.R2_BUCKET||"",
    accessKeyId:e.R2_ACCESS_KEY_ID||"",secretAccessKey:e.R2_SECRET_ACCESS_KEY||""
  };
  if(!validateR2(cfg))return result("R2_CONFIG_INCOMPLETE",503);
  try{
    const url=presignPrivateR2HeadBucket(cfg);
    const response=await fetch(url,{method:"HEAD",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(7000)});
    if(response.ok)return result("PRIVATE_BUCKET_REACHABLE",200);
    if(response.status===403||response.status===401)return result("R2_CREDENTIALS_OR_PERMISSIONS",503);
    if(response.status===404)return result("R2_BUCKET_NOT_FOUND",503);
    return result("R2_HEAD_FAILED",503);
  }catch{
    return result("R2_NETWORK_OR_SIGNATURE_FAILURE",503);
  }
}
