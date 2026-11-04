import "server-only";
import { NextRequest } from "next/server";
import { adminConfig, verifiedAdmin } from "@/modules/auth/admin-server";
import { ADMIN_COOKIE, unsealAdminSession } from "@/modules/auth/session";
import { enrollmentDb, enrollmentHeaders } from "@/modules/enrollment/server";
import { getOtaServerConfig } from "@/modules/ota/server";
import {
  parseProfileEvidenceReport,
  profileEvidenceToRow,
  ProfileEvidenceError,
} from "@/modules/ota/profile-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Records provisioning-profile evidence produced by workers/profile_intake.py
 * (run inside the quarantine/sandbox pipeline on the raw .mobileprovision).
 * The raw profile file is never accepted here and no field of this report
 * can raise signature trust: the stored row is metadata evidence only, and
 * OTA still requires a verifier attestation for the artifact itself.
 */
export async function POST(req: NextRequest) {
  const adminCfg = adminConfig();
  const otaCfg = getOtaServerConfig();
  if (!adminCfg || !otaCfg) {
    return Response.json({ error: "PROFILE_INTAKE_NOT_CONFIGURED" }, { status: 503, headers: enrollmentHeaders });
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
    if (raw.length > 65536) throw new Error("too large");
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400, headers: enrollmentHeaders });
  }
  let row: ReturnType<typeof profileEvidenceToRow>;
  try {
    row = profileEvidenceToRow(parseProfileEvidenceReport(body));
  } catch (error) {
    const code = error instanceof ProfileEvidenceError ? error.code : "PROFILE_EVIDENCE_INVALID";
    return Response.json({ error: code }, { status: 422, headers: enrollmentHeaders });
  }
  try {
    const stored = await enrollmentDb<Array<{ id: string }>>(
      { supabaseUrl: otaCfg.supabaseUrl, serviceKey: otaCfg.serviceKey },
      "provisioning_profiles",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(row),
      },
    );
    const id = stored[0]?.id;
    if (typeof id !== "string") throw new Error("no row");
    return Response.json(
      { profileId: id, chainTrusted: false, installEligible: false },
      { status: 201, headers: enrollmentHeaders },
    );
  } catch {
    return Response.json(
      { error: "PROFILE_INTAKE_STORE_UNAVAILABLE" },
      { status: 503, headers: enrollmentHeaders },
    );
  }
}
