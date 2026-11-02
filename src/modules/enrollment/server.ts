import "server-only";
import { sha256, keyFromBase64 } from "./secure";

export interface EnrollmentConfig {
  appOrigin: string;
  supabaseUrl: string;
  serviceKey: string;
  providerStartUrl: string;
  providerIssuer: string;
  providerPublicKey: string;
  encryptionKey: Buffer;
  trustedIpHeader: string;
}
export function getEnrollmentConfig(): EnrollmentConfig | null {
  if (process.env.ENROLLMENT_ENABLED !== "true" || process.env.ENROLLMENT_WAF_READY !== "true") return null;
  const e = process.env;
  if (!e.APP_ORIGIN || !e.NEXT_PUBLIC_SUPABASE_URL || !e.SUPABASE_SECRET_KEY
    || !e.ENROLLMENT_PROVIDER_START_URL || !e.ENROLLMENT_PROVIDER_ISSUER
    || !e.ENROLLMENT_PROVIDER_PUBLIC_KEY_B64 || !e.ENROLLMENT_UDID_ENCRYPTION_KEY_B64
    || !e.ENROLLMENT_TRUSTED_IP_HEADER) return null;
  try {
    const origin = new URL(e.APP_ORIGIN).origin;
    const db = new URL(e.NEXT_PUBLIC_SUPABASE_URL).origin;
    const provider = new URL(e.ENROLLMENT_PROVIDER_START_URL);
    if (new URL(e.APP_ORIGIN).origin !== e.APP_ORIGIN || ![origin,db,provider.origin].every(u => u.startsWith("https://"))
      || provider.username || provider.password || provider.hash || provider.port)
      return null;
    const key = keyFromBase64(e.ENROLLMENT_UDID_ENCRYPTION_KEY_B64);
    if (!/^[a-z0-9-]+$/i.test(e.ENROLLMENT_TRUSTED_IP_HEADER)) return null;
    return { appOrigin:origin, supabaseUrl:db, serviceKey:e.SUPABASE_SECRET_KEY,
      providerStartUrl:provider.toString(), providerIssuer:e.ENROLLMENT_PROVIDER_ISSUER,
      providerPublicKey:e.ENROLLMENT_PROVIDER_PUBLIC_KEY_B64, encryptionKey:key,
      trustedIpHeader:e.ENROLLMENT_TRUSTED_IP_HEADER.toLowerCase() };
  } catch { return null; }
}
export async function enrollmentDb<T>(config: EnrollmentConfig, path: string, init: RequestInit = {}): Promise<T> {
  const url = new URL("/rest/v1/" + path, config.supabaseUrl);
  const headers = new Headers(init.headers);
  headers.set("apikey", config.serviceKey);
  if (!config.serviceKey.startsWith("sb_secret_")) headers.set("Authorization", "Bearer " + config.serviceKey);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const r = await fetch(url, { ...init, headers, cache:"no-store", signal:AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error("Enrollment database unavailable");
  if (r.status === 204) return null as T;
  return await r.json() as T;
}
export const tokenHash = sha256;
export const enrollmentHeaders = {
  "Cache-Control":"no-store, max-age=0",
  "Referrer-Policy":"no-referrer",
  "X-Content-Type-Options":"nosniff"
};
export const unavailable = () => Response.json(
  { error:"PROFILE_SERVICE_NOT_CONFIGURED", message:"Dịch vụ xác minh profile chưa sẵn sàng." },
  { status:503, headers: enrollmentHeaders }
);
