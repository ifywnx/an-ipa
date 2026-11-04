import type { OtaEvidence, OtaReleaseGate } from "../distribution/policy";

/**
 * Pure evidence mapping: persistent records -> OtaEvidence.
 *
 * This module never reads the environment and never holds a credential;
 * the database client is injected by the server-only composition layer
 * (evidence.ts / server.ts). Because nothing secret lives here, the full
 * mapping is unit-testable with a fake client. The schema assumptions and
 * reconciliation checklist live in evidence.ts and docs/OTA_ELIGIBILITY.md.
 */

export interface OtaDbClient {
  /** PostgREST-style select; path is everything after /rest/v1/. */
  select(path: string): Promise<unknown[]>;
}

export interface DeviceRow {
  id: string;
  status?: unknown;
  identity_verified?: unknown;
  apple_registered?: unknown;
  udid_ciphertext?: unknown;
  device_class?: unknown;
  apple_registered_year?: unknown;
}

export interface ProvisioningProfileRow {
  id: string;
  team_id?: unknown;
  bundle_id?: unknown;
  profile_type?: unknown;
  provisions_all_devices?: unknown;
  provisioned_udids?: unknown;
  expires_at?: unknown;
}

export interface AppRow {
  id: string;
  name?: unknown;
  published?: unknown;
}

export interface AppVersionRow {
  id: string;
  app_id?: unknown;
  version?: unknown;
  bundle_id?: unknown;
  published?: unknown;
  status?: unknown;
  provisioning_profile_id?: unknown;
  ipa_asset_id?: unknown;
}

export interface IpaAssetRow {
  id: string;
  sha256?: unknown;
  object_key?: unknown;
}

export interface DistributionChannelRow {
  id: string;
  version_id?: unknown;
  channel?: unknown;
  status?: unknown;
  rights_reviewed?: unknown;
}

export interface VerifierAttestationRow {
  id: string;
  asset_id?: unknown;
  artifact_sha256?: unknown;
  signature_verified?: unknown;
  nested_signatures_present?: unknown;
  nested_team_matches?: unknown;
  dylib_dependencies_resolved?: unknown;
  artifact_team_id?: unknown;
  entitlements_match?: unknown;
  signing_certificate_expires_at?: unknown;
  signing_certificate_revoked?: unknown;
  verified_at?: unknown;
}

export interface OtaInstallContext {
  evidence: OtaEvidence;
  appPublished: boolean;
  versionPublished: boolean;
  artifactVerified: boolean;
  distributionRightsReviewed: boolean;
  artifactSha256: string;
  bundleIdentifier: string;
  version: string;
  title: string;
  /** Private R2 object key of the artifact; never exposed to clients. */
  objectKey: string;
  deviceId: string;
  versionId: string;
  channelId: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function asBool(value: unknown): boolean {
  return value === true;
}
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
function first(rows: unknown[]): Record<string, unknown> | null {
  const row = rows[0];
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

export interface OtaEvidenceAdapterOptions {
  releaseGate: OtaReleaseGate;
  /** Decrypts devices.udid_ciphertext (enrollment/secure.ts format). */
  decryptUdid?: (ciphertext: string) => string;
}

export class SupabaseOtaEvidenceAdapter {
  constructor(
    private readonly db: OtaDbClient,
    private readonly options: OtaEvidenceAdapterOptions,
  ) {}

  private async one(path: string): Promise<Record<string, unknown> | null> {
    try {
      return first(await this.db.select(path));
    } catch {
      return null;
    }
  }

  async loadInstallContext(deviceId: string, versionId: string): Promise<OtaInstallContext | null> {
    if (!UUID_PATTERN.test(deviceId) || !UUID_PATTERN.test(versionId)) return null;

    const device = await this.one(
      `devices?select=id,status,identity_verified,apple_registered,udid_ciphertext&id=eq.${deviceId}&limit=1`,
    );
    if (!device) return null;
    const version = await this.one(
      `app_versions?select=id,app_id,version,bundle_id,published,status,provisioning_profile_id,ipa_asset_id&id=eq.${versionId}&limit=1`,
    );
    if (!version || typeof version.app_id !== "string" || !UUID_PATTERN.test(version.app_id)) return null;

    const app = await this.one(
      `apps?select=id,name,published&id=eq.${version.app_id}&limit=1`,
    );
    if (!app) return null;

    let asset: Record<string, unknown> | null = null;
    if (typeof version.ipa_asset_id === "string" && UUID_PATTERN.test(version.ipa_asset_id)) {
      asset = await this.one(
        `ipa_assets?select=id,sha256,object_key&id=eq.${version.ipa_asset_id}&limit=1`,
      );
    }
    asset ??= await this.one(
      `ipa_assets?select=id,sha256,object_key&version_id=eq.${versionId}&order=created_at.desc&limit=1`,
    );
    if (!asset || typeof asset.id !== "string") return null;

    const channel = await this.one(
      `distribution_channels?select=id,version_id,channel,status,rights_reviewed&version_id=eq.${versionId}&order=created_at.desc&limit=1`,
    );

    let profile: Record<string, unknown> | null = null;
    if (typeof version.provisioning_profile_id === "string" && UUID_PATTERN.test(version.provisioning_profile_id)) {
      profile = await this.one(
        `provisioning_profiles?select=id,team_id,bundle_id,profile_type,provisions_all_devices,provisioned_udids,expires_at&id=eq.${version.provisioning_profile_id}&limit=1`,
      );
    }
    if (!profile && typeof version.bundle_id === "string" && version.bundle_id) {
      profile = await this.one(
        `provisioning_profiles?select=id,team_id,bundle_id,profile_type,provisions_all_devices,provisioned_udids,expires_at&bundle_id=eq.${encodeURIComponent(version.bundle_id)}&order=expires_at.desc&limit=1`,
      );
    }

    const attestation = await this.one(
      `verifier_attestations?select=id,asset_id,artifact_sha256,signature_verified,nested_signatures_present,nested_team_matches,dylib_dependencies_resolved,artifact_team_id,entitlements_match,signing_certificate_expires_at,signing_certificate_revoked,verified_at&asset_id=eq.${asset.id}&order=verified_at.desc&limit=1`,
    );

    const artifactSha256 = asString(asset.sha256).toLowerCase();
    const attested = !!attestation
      && asString(attestation.artifact_sha256).toLowerCase() === artifactSha256
      && SHA256_PATTERN.test(artifactSha256);

    let deviceUdid = "";
    if (typeof device.udid_ciphertext === "string" && this.options.decryptUdid) {
      try {
        deviceUdid = this.options.decryptUdid(device.udid_ciphertext);
      } catch {
        deviceUdid = "";
      }
    }

    const rightsReviewed = asBool(channel?.rights_reviewed);
    const evidence: OtaEvidence = {
      deviceStatus: asString(device.status),
      deviceIdentityVerified: asBool(device.identity_verified),
      appleRegistered: asBool(device.apple_registered),
      deviceUdid,
      profileUdids: asStringArray(profile?.provisioned_udids),
      profileExpiresAt: asString(profile?.expires_at),
      profileType: asString(profile?.profile_type),
      provisionsAllDevices: asBool(profile?.provisions_all_devices),
      profileTeamId: asString(profile?.team_id),
      artifactTeamId: attested ? asString(attestation?.artifact_team_id) : "",
      signatureVerified: attested && asBool(attestation?.signature_verified),
      nestedSignaturesPresent: attested && asBool(attestation?.nested_signatures_present),
      nestedTeamMatches: attested && asBool(attestation?.nested_team_matches),
      dylibDependenciesResolved: attested && asBool(attestation?.dylib_dependencies_resolved),
      signingCertificateExpiresAt: attested ? asString(attestation?.signing_certificate_expires_at) : "",
      signingCertificateRevoked: attested && asBool(attestation?.signing_certificate_revoked),
      entitlementsMatch: attested && asBool(attestation?.entitlements_match),
      bundleId: asString(version.bundle_id),
      profileBundleId: asString(profile?.bundle_id),
      distributionAuthorized: rightsReviewed,
      channel: asString(channel?.channel),
      channelStatus: asString(channel?.status),
      // The caller overwrites this from the actual grant record; a context
      // loaded for issuance describes a grant that does not exist yet.
      grantRevoked: false,
      verifiedArtifactSha256: artifactSha256,
      releaseGate: this.options.releaseGate,
    };

    return {
      evidence,
      appPublished: asBool(app.published),
      versionPublished: asBool(version.published) || version.status === "published",
      artifactVerified: attested,
      distributionRightsReviewed: rightsReviewed,
      artifactSha256,
      bundleIdentifier: asString(version.bundle_id),
      version: asString(version.version),
      title: asString(app.name),
      objectKey: asString(asset.object_key),
      deviceId,
      versionId,
      channelId: typeof channel?.id === "string" ? channel.id : null,
    };
  }
}

/** Apple Ad Hoc ceiling: 100 registered devices per device class per membership year. */
export const APPLE_DEVICE_CLASS_LIMIT = 100;

export interface AppleQuotaClassSummary {
  deviceClass: string;
  registered: number;
  limit: number;
  remaining: number;
}

export interface AppleQuotaSummary {
  /** False only when produced without a database connection (see loader). */
  connected: boolean;
  membershipYear: number | null;
  classes: AppleQuotaClassSummary[];
  totalRegistered: number;
}

/**
 * Pure quota summary. Rows without a recorded registration year are counted
 * (conservative: overstating usage is safer than overstating free slots).
 * Unknown device classes are reported under their own name with the same
 * 100 ceiling rather than being silently dropped.
 */
export function summarizeAppleQuota(
  rows: ReadonlyArray<Pick<DeviceRow, "device_class" | "apple_registered_year">>,
  membershipYear: number | null,
): AppleQuotaSummary {
  const counts = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const year = typeof row.apple_registered_year === "number" ? row.apple_registered_year : null;
    if (membershipYear !== null && year !== null && year !== membershipYear) continue;
    const deviceClass = (typeof row.device_class === "string" && row.device_class
      ? row.device_class : "unknown").toLowerCase();
    counts.set(deviceClass, (counts.get(deviceClass) ?? 0) + 1);
    total += 1;
  }
  const classes = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([deviceClass, registered]) => ({
      deviceClass,
      registered,
      limit: APPLE_DEVICE_CLASS_LIMIT,
      remaining: Math.max(0, APPLE_DEVICE_CLASS_LIMIT - registered),
    }));
  return { connected: true, membershipYear, classes, totalRegistered: total };
}

export async function loadAppleQuotaSummary(
  db: OtaDbClient,
  membershipYear: number | null = null,
): Promise<AppleQuotaSummary> {
  const rows = await db.select(
    "devices?select=id,device_class,apple_registered_year&apple_registered=eq.true&limit=1000",
  );
  return summarizeAppleQuota(rows as DeviceRow[], membershipYear);
}

export const UNCONNECTED_APPLE_QUOTA: AppleQuotaSummary = Object.freeze({
  connected: false,
  membershipYear: null,
  classes: [],
  totalRegistered: 0,
});
