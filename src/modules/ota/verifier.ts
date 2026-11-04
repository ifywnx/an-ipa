/**
 * Contract for macOS verifier output (workers/macos-verifier/verify.py).
 *
 * A parsed attestation is still only a *record*: it becomes OTA evidence
 * when a server operator stores it in verifier_attestations and the
 * evidence adapter binds it to the asset's exact SHA-256. This parser is
 * fail-closed and rejects any document that claims install eligibility —
 * verifiers report facts, the server policy decides.
 */
export interface VerifierAttestation {
  verifierId: string;
  verifiedAt: string;
  artifactSha256: string;
  bundleId: string;
  signatureVerified: boolean;
  nestedSignaturesPresent: boolean;
  nestedTeamMatches: boolean;
  dylibDependenciesResolved: boolean;
  artifactTeamId: string | null;
  entitlementsMatch: boolean;
  signingCertificateExpiresAt: string | null;
  signingCertificateRevoked: boolean;
  profileTeamId: string | null;
  profileBundleId: string | null;
  profileExpiresAt: string | null;
  profileType: string | null;
  provisionsAllDevices: boolean;
}

export class VerifierAttestationError extends Error {
  constructor(public readonly code: string) {
    super("Verifier attestation rejected: " + code);
  }
}

function reject(code: string): never {
  throw new VerifierAttestationError(code);
}

function boolField(r: Record<string, unknown>, key: string): boolean {
  if (typeof r[key] !== "boolean") reject("VERIFIER_FIELD_INVALID:" + key);
  return r[key] as boolean;
}

function nullableString(r: Record<string, unknown>, key: string): string | null {
  const value = r[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 256) reject("VERIFIER_FIELD_INVALID:" + key);
  return value;
}

export function parseVerifierAttestation(value: unknown): VerifierAttestation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject("VERIFIER_NOT_AN_OBJECT");
  }
  const r = value as Record<string, unknown>;
  if (r.install_eligible !== false) reject("VERIFIER_ELIGIBILITY_CLAIM");
  if (typeof r.verifier_id !== "string" || !r.verifier_id || r.verifier_id.length > 120) {
    reject("VERIFIER_ID_INVALID");
  }
  if (typeof r.verified_at !== "string" || !Number.isFinite(Date.parse(r.verified_at))) {
    reject("VERIFIER_TIME_INVALID");
  }
  if (typeof r.artifact_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(r.artifact_sha256)) {
    reject("VERIFIER_HASH_INVALID");
  }
  if (typeof r.bundle_id !== "string"
    || !/^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+$/.test(r.bundle_id)) {
    reject("VERIFIER_BUNDLE_INVALID");
  }
  const certExpiry = nullableString(r, "signing_certificate_expires_at");
  if (certExpiry !== null && !Number.isFinite(Date.parse(certExpiry))) {
    reject("VERIFIER_CERT_EXPIRY_INVALID");
  }
  const profileExpires = nullableString(r, "profile_expires_at");
  if (profileExpires !== null && !Number.isFinite(Date.parse(profileExpires))) {
    reject("VERIFIER_PROFILE_EXPIRY_INVALID");
  }
  return {
    verifierId: r.verifier_id,
    verifiedAt: new Date(r.verified_at).toISOString(),
    artifactSha256: r.artifact_sha256,
    bundleId: r.bundle_id,
    signatureVerified: boolField(r, "signature_verified"),
    nestedSignaturesPresent: boolField(r, "nested_signatures_present"),
    nestedTeamMatches: boolField(r, "nested_team_matches"),
    dylibDependenciesResolved: boolField(r, "dylib_dependencies_resolved"),
    artifactTeamId: nullableString(r, "artifact_team_id"),
    entitlementsMatch: boolField(r, "entitlements_match"),
    signingCertificateExpiresAt: certExpiry,
    signingCertificateRevoked: boolField(r, "signing_certificate_revoked"),
    profileTeamId: nullableString(r, "profile_team_id"),
    profileBundleId: nullableString(r, "profile_bundle_id"),
    profileExpiresAt: profileExpires,
    profileType: nullableString(r, "profile_type"),
    provisionsAllDevices: r.provisions_all_devices === true,
  };
}

/** Row shape for the verifier_attestations table (migration 20261105090000). */
export function verifierAttestationToRow(attestation: VerifierAttestation, assetId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId)) {
    reject("VERIFIER_ASSET_ID_INVALID");
  }
  return {
    asset_id: assetId,
    artifact_sha256: attestation.artifactSha256,
    verifier_id: attestation.verifierId,
    signature_verified: attestation.signatureVerified,
    nested_signatures_present: attestation.nestedSignaturesPresent,
    nested_team_matches: attestation.nestedTeamMatches,
    dylib_dependencies_resolved: attestation.dylibDependenciesResolved,
    artifact_team_id: attestation.artifactTeamId,
    entitlements_match: attestation.entitlementsMatch,
    signing_certificate_expires_at: attestation.signingCertificateExpiresAt,
    signing_certificate_revoked: attestation.signingCertificateRevoked,
    verified_at: attestation.verifiedAt,
  };
}
