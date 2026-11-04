import { validateUdid } from "../devices/policy";

/**
 * Typed boundary for workers/profile_intake.py output.
 *
 * The worker report is UNTRUSTED metadata: CMS content integrity only, no
 * Apple chain trust. This parser is fail-closed — a report that claims
 * chain trust, lacks an integrity proof, or carries malformed fields is
 * rejected outright instead of being partially believed. Profile evidence
 * supplies team / bundle / UDIDs / expiry / type to the OTA adapter; it can
 * never set signature-verification evidence by itself.
 */
export interface ProvisioningProfileEvidence {
  uuid: string;
  teamId: string;
  bundleId: string | null;
  bundleWildcard: boolean;
  profileType: string;
  provisionsAllDevices: boolean;
  provisionedUdids: string[];
  expiresAt: string;
  expired: boolean;
  getTaskAllow: boolean;
}

export class ProfileEvidenceError extends Error {
  constructor(public readonly code: string) {
    super("Profile evidence rejected: " + code);
  }
}

function reject(code: string): never {
  throw new ProfileEvidenceError(code);
}

export function parseProfileEvidenceReport(value: unknown): ProvisioningProfileEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject("PROFILE_EVIDENCE_NOT_AN_OBJECT");
  }
  const r = value as Record<string, unknown>;
  if (r.evidence_source !== "profile_intake_untrusted_metadata") {
    reject("PROFILE_EVIDENCE_SOURCE_UNKNOWN");
  }
  if (r.cms_content_integrity !== true) reject("PROFILE_EVIDENCE_INTEGRITY_UNPROVEN");
  if (r.apple_signer_chain_trusted !== false) reject("PROFILE_EVIDENCE_CHAIN_CLAIM");
  if (r.install_eligible !== false) reject("PROFILE_EVIDENCE_ELIGIBILITY_CLAIM");

  if (typeof r.uuid !== "string" || r.uuid.length < 1 || r.uuid.length > 64) {
    reject("PROFILE_EVIDENCE_UUID_INVALID");
  }
  if (typeof r.team_id !== "string" || !r.team_id || r.team_id.length > 64) {
    reject("PROFILE_EVIDENCE_TEAM_INVALID");
  }
  if (typeof r.profile_type !== "string" || !r.profile_type) {
    reject("PROFILE_EVIDENCE_TYPE_INVALID");
  }
  if (typeof r.expires_at !== "string" || !Number.isFinite(Date.parse(r.expires_at))) {
    reject("PROFILE_EVIDENCE_EXPIRY_INVALID");
  }
  if (!Array.isArray(r.provisioned_udids) || r.provisioned_udids.length > 1000) {
    reject("PROFILE_EVIDENCE_DEVICES_INVALID");
  }
  const provisionedUdids = r.provisioned_udids.map((entry) => {
    const validation = validateUdid(entry);
    if (!validation.valid || !validation.normalized) {
      reject("PROFILE_EVIDENCE_DEVICES_INVALID");
    }
    return validation.normalized as string;
  });
  const bundleWildcard = r.bundle_wildcard === true;
  let bundleId: string | null = null;
  if (!bundleWildcard) {
    if (typeof r.bundle_id !== "string"
      || !/^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+$/.test(r.bundle_id)) {
      reject("PROFILE_EVIDENCE_BUNDLE_INVALID");
    }
    bundleId = r.bundle_id;
  }
  return {
    uuid: r.uuid,
    teamId: r.team_id,
    bundleId,
    bundleWildcard,
    profileType: r.profile_type,
    provisionsAllDevices: r.provisions_all_devices === true,
    provisionedUdids,
    expiresAt: new Date(r.expires_at).toISOString(),
    expired: r.expired === true,
    getTaskAllow: r.get_task_allow === true,
  };
}

/** Row shape consumed by SupabaseOtaEvidenceAdapter from provisioning_profiles. */
export function profileEvidenceToRow(evidence: ProvisioningProfileEvidence) {
  return {
    uuid: evidence.uuid,
    team_id: evidence.teamId,
    bundle_id: evidence.bundleId,
    profile_type: evidence.profileType,
    provisions_all_devices: evidence.provisionsAllDevices,
    provisioned_udids: evidence.provisionedUdids,
    expires_at: evidence.expiresAt,
  };
}
