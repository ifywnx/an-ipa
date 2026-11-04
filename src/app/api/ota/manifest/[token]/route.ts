import "server-only";
import { enrollmentHeaders } from "@/modules/enrollment/server";
import {
  createOtaFlowDeps,
  getOtaServerConfig,
  serveOtaManifest,
} from "@/modules/ota/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public OTA manifest endpoint. The bearer token names one stored grant;
 * the grant and ALL evidence are reloaded and re-checked on every fetch.
 * With the OTA flags closed this returns OTA_INSTALL_DISABLED and serves
 * no manifest to anyone.
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
  const result = await serveOtaManifest(createOtaFlowDeps(otaCfg), token);
  if (!result.ok) {
    return Response.json(
      { error: result.denials[0] ?? "OTA_DENIED", denials: result.denials },
      { status: result.status, headers: enrollmentHeaders },
    );
  }
  return new Response(result.body, {
    status: 200,
    headers: { ...enrollmentHeaders, "Content-Type": result.contentType },
  });
}
