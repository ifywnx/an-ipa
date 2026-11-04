import "server-only";
import { NextRequest } from "next/server";
import { adminConfig, verifiedAdmin } from "@/modules/auth/admin-server";
import { ADMIN_COOKIE, unsealAdminSession } from "@/modules/auth/session";
import { enrollmentHeaders } from "@/modules/enrollment/server";
import { isUuid } from "@/modules/ota/grants";
import {
  createOtaFlowDeps,
  getOtaServerConfig,
  issueInstallGrant,
} from "@/modules/ota/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-only issuance of a persistent OTA install grant. Evidence is loaded
 * from trusted server records; the request body may only name the device
 * and version. When either OTA flag is closed the domain policy denies and
 * nothing is persisted.
 */
export async function POST(req: NextRequest) {
  const adminCfg = adminConfig();
  const otaCfg = getOtaServerConfig();
  if (!adminCfg || !otaCfg) {
    return Response.json({ error: "OTA_NOT_CONFIGURED" }, { status: 503, headers: enrollmentHeaders });
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
    if (raw.length > 2000) throw new Error("too large");
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400, headers: enrollmentHeaders });
  }
  const input = (body ?? {}) as Record<string, unknown>;
  if (!isUuid(input.deviceId) || !isUuid(input.versionId)) {
    return Response.json({ error: "INVALID_TARGET" }, { status: 400, headers: enrollmentHeaders });
  }
  const result = await issueInstallGrant(createOtaFlowDeps(otaCfg), {
    deviceId: input.deviceId,
    versionId: input.versionId,
    createdBy: admin.id,
  });
  if (!result.ok) {
    const status = result.denials.includes("OTA_CONTEXT_NOT_FOUND") ? 404 : 422;
    return Response.json(
      { error: "OTA_DENIED", denials: result.denials },
      { status, headers: enrollmentHeaders },
    );
  }
  return Response.json(
    {
      grantId: result.record.id,
      token: result.token,
      expiresAt: result.record.expiresAt,
      manifestUrl: result.manifestUrl,
      itmsServicesUrl: result.itmsServicesUrl,
    },
    { status: 201, headers: enrollmentHeaders },
  );
}
