import { NextRequest } from "next/server";
import { getEnrollmentConfig, enrollmentDb, enrollmentHeaders, tokenHash, unavailable } from "@/modules/enrollment/server";
import { getSelfProfileConfig } from "@/modules/enrollment/self-profile";
import { decryptUdid } from "@/modules/enrollment/secure";
export const runtime = "nodejs";
interface Row {status:string; expires_at:string; udid_ciphertext:string|null}
// Sessions live in the same table whichever mode created them; status reads
// work under either configuration. Provider config wins when both exist.
function sessionConfig() {
  return getEnrollmentConfig() ?? getSelfProfileConfig();
}
export async function GET(request:NextRequest) {
  const config=sessionConfig();
  if (!config) return unavailable();
  const token=request.cookies.get("an_enrollment")?.value;
  if (!token || !/^[A-Za-z0-9_-]{40,64}$/.test(token))
    return Response.json({status:"not_started"},{headers:enrollmentHeaders});
  try {
    const rows=await enrollmentDb<Row[]>(config,
      "guest_enrollments?select=status,expires_at,udid_ciphertext&browser_token_hash=eq."+tokenHash(token)+"&limit=1");
    const row=rows[0];
    if (!row) return Response.json({status:"not_started"},{headers:enrollmentHeaders});
    if (!Number.isFinite(Date.parse(row.expires_at)) || Date.now()>=Date.parse(row.expires_at))
      return Response.json({status:"expired"},{headers:enrollmentHeaders});
    if (row.status==="verified" && row.udid_ciphertext) {
      const udid=decryptUdid(config.encryptionKey,row.udid_ciphertext);
      return Response.json({status:"verified",udid,notice:"Đã xác minh danh tính thiết bị; chưa có nghĩa Apple đã đăng ký Ad Hoc."},{headers:enrollmentHeaders});
    }
    if (row.status==="device_reported" && row.udid_ciphertext) {
      // Self-profile mode: the UDID is what the device itself reported. It
      // is pending owner verification — never present it as verified.
      const udid=decryptUdid(config.encryptionKey,row.udid_ciphertext);
      return Response.json({status:"device_reported",udid,notice:"UDID do máy của bạn gửi về, đang chờ xác minh. Chưa phải xác minh danh tính thiết bị, chưa được Apple đăng ký và chưa cho phép cài OTA."},{headers:enrollmentHeaders});
    }
    return Response.json({status:"pending"},{headers:enrollmentHeaders});
  } catch {
    return Response.json({status:"unavailable"},{status:503,headers:enrollmentHeaders});
  }
}

/** Explicit guest data deletion; same-origin only; browser may request it anytime in valid session. */
export async function DELETE(request:NextRequest) {
  const config=sessionConfig();
  if(!config) return unavailable();
  if(request.headers.get("origin")!==config.appOrigin)
    return Response.json({deleted:false},{status:403,headers:enrollmentHeaders});
  const token=request.cookies.get("an_enrollment")?.value;
  if(!token || !/^[A-Za-z0-9_-]{40,64}$/.test(token))
    return Response.json({deleted:false},{status:400,headers:enrollmentHeaders});
  try {
    await enrollmentDb<unknown>(config,
      "guest_enrollments?browser_token_hash=eq."+tokenHash(token),
      {method:"DELETE",headers:{"Prefer":"return=minimal"}});
  } catch {return Response.json({deleted:false},{status:503,headers:enrollmentHeaders});}
  const response=Response.json({deleted:true},{headers:enrollmentHeaders});
  response.headers.append("Set-Cookie","an_enrollment=; Path=/api/enrollment; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  return response;
}
