import "server-only";
import { NextRequest } from "next/server";
import { adminConfig, verifiedAdmin } from "@/modules/auth/admin-server";
import { ADMIN_COOKIE, unsealAdminSession } from "@/modules/auth/session";
import { enrollmentDb, enrollmentHeaders } from "@/modules/enrollment/server";
import { getOtaServerConfig } from "@/modules/ota/server";
import {
  parseVerifierAttestation,
  verifierAttestationToRow,
  VerifierAttestationError,
} from "@/modules/ota/verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Records one macOS verifier attestation (workers/macos-verifier output)
 * for an IPA asset. Admin-only: attestations are how trusted signature
 * evidence enters the system, so they are never accepted from clients or
 * from the untrusted Linux inspection workers.
 */
export async function POST(req: NextRequest) {
  const adminCfg = adminConfig();
  const otaCfg = getOtaServerConfig();
  if (!adminCfg || !otaCfg) {
    return Response.json({ error: "VERIFIER_INTAKE_NOT_CONFIGURED" }, { status: 503, headers: enrollmentHeaders });
  }
  const cookie = req.cookies.get(ADMIN_COOKIE)?.value;
  const session = cookie ? unsealAdminSession(cookie, adminCfg.cookieKey) : null;
  if (!session) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: enrollmentHeaders });
  }
  const admin = await verifiedAdmin(session.accessToken, adminCfg);
  if (!admin) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: enrollmentHeaders });
  }
  if (req.headers.get("origin") !== adminCfg.origin) {
    return Response.json({ error: "BAD_ORIGIN" }, { status: 403, headers: enrollmentHeaders });
  }
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 32768) throw new Error("too large");
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400, headers: enrollmentHeaders });
  }
  const wrapper = body as { assetId?: unknown; attestation?: unknown } | null;
  let row: ReturnType<typeof verifierAttestationToRow>;
  try {
    if (!wrapper || typeof wrapper !== "object") throw new VerifierAttestationError("VERIFIER_BODY_INVALID");
    row = verifierAttestationToRow(
      parseVerifierAttestation(wrapper.attestation),
      typeof wrapper.assetId === "string" ? wrapper.assetId : "",
    );
  } catch (error) {
    const code = error instanceof VerifierAttestationError ? error.code : "VERIFIER_ATTESTATION_INVALID";
    return Response.json({ error: code }, { status: 422, headers: enrollmentHeaders });
  }
  try {
    const stored = await enrollmentDb<Array<{ id: string }>>(
      { supabaseUrl: otaCfg.supabaseUrl, serviceKey: otaCfg.serviceKey },
      "verifier_attestations",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(row),
      },
    );
    const id = stored[0]?.id;
    if (typeof id !== "string") throw new Error("no row");
    return Response.json({ attestationId: id }, { status: 201, headers: enrollmentHeaders });
  } catch {
    return Response.json(
      { error: "VERIFIER_INTAKE_STORE_UNAVAILABLE" },
      { status: 503, headers: enrollmentHeaders },
    );
  }
}
