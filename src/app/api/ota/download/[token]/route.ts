import "server-only";
import { enrollmentHeaders } from "@/modules/enrollment/server";
import {
  createOtaFlowDeps,
  getOtaServerConfig,
  serveOtaDownload,
} from "@/modules/ota/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public OTA artifact endpoint. Re-validates the grant exactly like the
 * manifest route, then redirects to a presigned private-R2 GET whose TTL
 * never exceeds the grant's remaining window (max 300s). The R2 object key
 * and storage credentials never reach the client.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const otaCfg = getOtaServerConfig();
  if (!otaCfg) {
    return Response.json(
      { error: "OTA_NOT_CONFIGURED" },
      { status: 503, headers: enrollmentHeaders },
    );
  }
  const { token } = await params;
  const result = await serveOtaDownload(createOtaFlowDeps(otaCfg), token);
  if (!result.ok) {
    return Response.json(
      { error: result.denials[0] ?? "OTA_DENIED", denials: result.denials },
      { status: result.status, headers: enrollmentHeaders },
    );
  }
  return new Response(null, {
    status: 302,
    headers: { ...enrollmentHeaders, Location: result.location },
  });
}
