import { sha256 } from "../enrollment/secure";
import {
  buildInstallGrantRecord,
  installGrantRecordDenials,
  INSTALL_GRANT_TOKEN_PATTERN,
  type InstallGrantRecord,
  type InstallGrantRepository,
} from "./grants";
import type { SupabaseOtaEvidenceAdapter, OtaInstallContext } from "./evidence-map";
import {
  buildItmsServicesUrl,
  buildOtaManifest,
  denyOtaGrant,
  type VerifiedOtaGrant,
} from "./manifest";

/**
 * Public OTA grant flow with injected dependencies. Pure orchestration:
 * no environment reads, no credentials. server.ts composes the real
 * dependencies (service-role repository + evidence adapter + R2 presign)
 * behind `server-only`; tests drive this exact code with fakes.
 *
 * Every manifest/download fetch reloads the stored grant AND fresh
 * evidence, then re-runs denyOtaGrant, so revocation, expiry, profile or
 * artifact changes after issuance take effect immediately. When either
 * release flag is closed the loaded evidence carries the closed gate and
 * issuance/fetching deny with OTA_INSTALL_DISABLED /
 * OTA_INSTALL_PIPELINE_NOT_READY; nothing is persisted for denied issuance.
 */

export interface OtaFlowDeps {
  grants: InstallGrantRepository;
  adapter: SupabaseOtaEvidenceAdapter;
  appOrigin: string;
  deliveryHosts: readonly string[];
  /** Returns a short-lived artifact URL, or null when storage is unconfigured. */
  presignGet: (objectKey: string, ttlSeconds: number, now: Date) => string | null;
  now?: () => Date;
}


function verifiedGrantFor(
  deps: OtaFlowDeps,
  ctx: OtaInstallContext,
  token: string,
  expiresAt: string,
): VerifiedOtaGrant {
  return {
    evidence: ctx.evidence,
    appPublished: ctx.appPublished,
    versionPublished: ctx.versionPublished,
    artifactVerified: ctx.artifactVerified,
    distributionRightsReviewed: ctx.distributionRightsReviewed,
    artifactSha256: ctx.artifactSha256,
    bundleIdentifier: ctx.bundleIdentifier,
    version: ctx.version,
    title: ctx.title,
    ipaUrl: `${deps.appOrigin}/api/ota/download/${token}`,
    manifestUrl: `${deps.appOrigin}/api/ota/manifest/${token}`,
    grantExpiresAt: expiresAt,
  };
}

export type IssueGrantResult =
  | {
      ok: true;
      token: string;
      record: InstallGrantRecord;
      manifestUrl: string;
      itmsServicesUrl: string;
    }
  | { ok: false; denials: string[] };

export async function issueInstallGrant(
  deps: OtaFlowDeps,
  input: { deviceId: string; versionId: string; createdBy?: string | null },
): Promise<IssueGrantResult> {
  const now = (deps.now ?? (() => new Date()))();
  const ctx = await deps.adapter.loadInstallContext(input.deviceId, input.versionId);
  if (!ctx) return { ok: false, denials: ["OTA_CONTEXT_NOT_FOUND"] };

  let built: { record: InstallGrantRecord; token: string };
  try {
    built = buildInstallGrantRecord({
      deviceId: ctx.deviceId,
      versionId: ctx.versionId,
      channelId: ctx.channelId,
      artifactSha256: ctx.artifactSha256,
      createdBy: input.createdBy ?? null,
      now,
    });
  } catch {
    return { ok: false, denials: ["INSTALL_GRANT_INPUT_INVALID"] };
  }
  const { record, token } = built;
  const verified = verifiedGrantFor(deps, ctx, token, record.expiresAt);
  const denials = denyOtaGrant(verified, deps.deliveryHosts, now);
  if (denials.length) return { ok: false, denials };

  await deps.grants.insert(record);
  return {
    ok: true,
    token,
    record,
    manifestUrl: verified.manifestUrl,
    itmsServicesUrl: buildItmsServicesUrl(verified, deps.deliveryHosts, now),
  };
}

export type GrantAccessResult =
  | { ok: true; record: InstallGrantRecord; ctx: OtaInstallContext; verified: VerifiedOtaGrant }
  | { ok: false; status: number; denials: string[] };

/**
 * Shared revalidation for the public manifest/download routes. The stored
 * grant is re-checked against freshly loaded evidence on EVERY fetch, so a
 * device/profile/channel change after issuance takes effect immediately.
 */
export async function loadGrantAccess(
  deps: OtaFlowDeps,
  token: string,
): Promise<GrantAccessResult> {
  const now = (deps.now ?? (() => new Date()))();
  if (!INSTALL_GRANT_TOKEN_PATTERN.test(token)) {
    return { ok: false, status: 400, denials: ["GRANT_TOKEN_INVALID"] };
  }
  const record = await deps.grants.findByTokenHash(sha256(token));
  if (!record) return { ok: false, status: 404, denials: ["GRANT_NOT_FOUND"] };
  const recordDenials = installGrantRecordDenials(record, now);
  if (recordDenials.length) {
    return {
      ok: false,
      status: recordDenials.includes("GRANT_EXPIRED") ? 410 : 403,
      denials: recordDenials,
    };
  }
  const ctx = await deps.adapter.loadInstallContext(record.deviceId, record.versionId);
  if (!ctx) return { ok: false, status: 503, denials: ["OTA_CONTEXT_UNAVAILABLE"] };
  if (ctx.artifactSha256 !== record.artifactSha256) {
    // The artifact changed after issuance; the old grant must not follow it.
    return { ok: false, status: 409, denials: ["ARTIFACT_HASH_MISMATCH"] };
  }
  const verified = verifiedGrantFor(deps, ctx, token, record.expiresAt);
  const denials = denyOtaGrant(verified, deps.deliveryHosts, now);
  if (denials.length) return { ok: false, status: 403, denials };
  return { ok: true, record, ctx, verified };
}

export type ServeManifestResult =
  | { ok: true; status: 200; contentType: string; body: string }
  | { ok: false; status: number; denials: string[] };

export async function serveOtaManifest(
  deps: OtaFlowDeps,
  token: string,
): Promise<ServeManifestResult> {
  const access = await loadGrantAccess(deps, token);
  if (!access.ok) return access;
  const now = (deps.now ?? (() => new Date()))();
  const body = buildOtaManifest(access.verified, deps.deliveryHosts, now);
  await deps.grants.markUsed(access.record.id, now);
  return { ok: true, status: 200, contentType: "application/x-plist; charset=utf-8", body };
}

export type ServeDownloadResult =
  | { ok: true; status: 302; location: string }
  | { ok: false; status: number; denials: string[] };

export async function serveOtaDownload(
  deps: OtaFlowDeps,
  token: string,
): Promise<ServeDownloadResult> {
  const access = await loadGrantAccess(deps, token);
  if (!access.ok) return access;
  const now = (deps.now ?? (() => new Date()))();
  const remainingSeconds = Math.floor(
    (Date.parse(access.record.expiresAt) - now.getTime()) / 1000,
  );
  const ttlSeconds = Math.max(1, Math.min(300, remainingSeconds));
  const location = deps.presignGet(access.ctx.objectKey, ttlSeconds, now);
  if (!location) return { ok: false, status: 503, denials: ["STORAGE_NOT_CONFIGURED"] };
  await deps.grants.markUsed(access.record.id, now);
  return { ok: true, status: 302, location };
}
