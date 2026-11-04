import { NextRequest } from "next/server";
import { getEnrollmentConfig, enrollmentDb, enrollmentHeaders, tokenHash, unavailable } from "@/modules/enrollment/server";
import { verifyProviderAttestation, encryptUdid, keyedHash } from "@/modules/enrollment/secure";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const config=getEnrollmentConfig();
  if (!config) return unavailable();
  if (Number(request.headers.get("content-length") || 0)>4096)
    return Response.json({accepted:false},{status:413,headers:enrollmentHeaders});
  try {
    const raw=await request.text();
    const att=verifyProviderAttestation(raw,request.headers.get("x-verified-device-signature")||"",
      config.providerPublicKey,config.appOrigin,config.providerIssuer);
    const changed=await enrollmentDb<boolean>(config,"rpc/complete_guest_enrollment",{
      method:"POST",
      body:JSON.stringify({
        p_challenge_hash:tokenHash(att.challenge),
        p_udid_ciphertext:encryptUdid(config.encryptionKey,att.udid),
        p_udid_hmac:keyedHash(config.encryptionKey,"udid",att.udid),
        p_provider_reference:att.provider_reference
      })
    });
    if (changed !== true) return Response.json({accepted:false},{status:409,headers:enrollmentHeaders});
    return Response.json({accepted:true},{headers:enrollmentHeaders});
  } catch {
    return Response.json({accepted:false},{status:403,headers:enrollmentHeaders});
  }
}
