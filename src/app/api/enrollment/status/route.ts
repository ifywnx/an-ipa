import { NextRequest } from "next/server";
import { getEnrollmentConfig, enrollmentDb, enrollmentHeaders, tokenHash, unavailable } from "@/modules/enrollment/server";
import { decryptUdid } from "@/modules/enrollment/secure";
export const runtime = "nodejs";
interface Row {status:string; expires_at:string; udid_ciphertext:string|null}
export async function GET(request:NextRequest) {
  const config=getEnrollmentConfig();
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
    if (row.status!=="verified" || !row.udid_ciphertext)
      return Response.json({status:"pending"},{headers:enrollmentHeaders});
    const udid=decryptUdid(config.encryptionKey,row.udid_ciphertext);
    return Response.json({status:"verified",udid,notice:"Đã xác minh danh tính thiết bị; chưa có nghĩa Apple đã đăng ký Ad Hoc."},{headers:enrollmentHeaders});
  } catch {
    return Response.json({status:"unavailable"},{status:503,headers:enrollmentHeaders});
  }
}
