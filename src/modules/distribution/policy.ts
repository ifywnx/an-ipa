import { normalizeUdid } from "../devices/policy";

// Use only with server-verified records. Never accept this evidence from a client.
export interface OtaReleaseGate {
  /** Public install-grant feature switch. Closed by default. */
  installEnabled: boolean;
  /** Separate readiness switch for the trusted verifier + delivery pipeline. */
  installPipelineReady: boolean;
}

export const CLOSED_OTA_RELEASE_GATE: Readonly<OtaReleaseGate> = Object.freeze({
  installEnabled: false,
  installPipelineReady: false,
});

/**
 * Build the release gate from server environment values. Only the exact
 * string "true" opens either half; a missing/malformed value stays closed.
 * Opening this gate in configuration does not by itself create a route or a
 * grant: a future server caller must still load trusted evidence and pass
 * every check below.
 */
export function otaReleaseGateFromEnv(env: {
  OTA_INSTALL_ENABLED?: string;
  OTA_INSTALL_PIPELINE_READY?: string;
} = {}): OtaReleaseGate {
  return {
    installEnabled: env.OTA_INSTALL_ENABLED === "true",
    installPipelineReady: env.OTA_INSTALL_PIPELINE_READY === "true",
  };
}

export interface OtaEvidence {
  /** Internal Admin review state for a persistent, trusted device record. */
  deviceStatus: string;
  /** Device identity was proven independently; manual intake never sets this. */
  deviceIdentityVerified: boolean;
  appleRegistered: boolean;
  deviceUdid: string;
  profileUdids: readonly string[];
  profileExpiresAt: string;
  /** Inspector/verifier classification; this policy implements Ad Hoc only. */
  profileType: string;
  provisionsAllDevices: boolean;
  profileTeamId: string;
  artifactTeamId: string;
  signatureVerified: boolean;
  /**
   * Trusted-verifier findings for nested Mach-O code. Every store IPA is a
   * dylib-injected build, so each nested executable must carry an embedded
   * signature, share the main executable's Team ID, and load only dylibs
   * that resolve on a non-jailbroken device. The quarantine inspector's
   * embedded-metadata scan informs review but never sets these by itself.
   */
  nestedSignaturesPresent: boolean;
  nestedTeamMatches: boolean;
  dylibDependenciesResolved: boolean;
  signingCertificateExpiresAt: string;
  signingCertificateRevoked: boolean;
  entitlementsMatch: boolean;
  bundleId: string;
  profileBundleId: string;
  distributionAuthorized: boolean;
  /** Existing distribution_channels projection: only ad_hoc is implemented here. */
  channel: string;
  channelStatus: string;
  grantRevoked: boolean;
  /** SHA-256 recorded by the trusted verifier for the exact artifact. */
  verifiedArtifactSha256: string;
  releaseGate: OtaReleaseGate;
}

function canonicalUdid(value: unknown): string | null {
  try {
    return normalizeUdid(value as string);
  } catch {
    return null;
  }
}

export function otaDenials(e: OtaEvidence, now = new Date()): string[] {
  const reasons: string[] = [];

  // Release gate first: both switches must be deliberately opened by a
  // server operator. Missing runtime evidence is treated as closed.
  if (e.releaseGate?.installEnabled !== true) reasons.push("OTA_INSTALL_DISABLED");
  if (e.releaseGate?.installPipelineReady !== true) reasons.push("OTA_INSTALL_PIPELINE_NOT_READY");

  if (e.channel !== "ad_hoc") reasons.push("DISTRIBUTION_CHANNEL_NOT_SUPPORTED");
  if (e.channelStatus === "revoked") reasons.push("CHANNEL_REVOKED");
  else if (e.channelStatus !== "published") reasons.push("CHANNEL_NOT_PUBLISHED");
  if (e.grantRevoked) reasons.push("GRANT_REVOKED");

  if (e.deviceStatus !== "approved") reasons.push("DEVICE_NOT_APPROVED");
  if (!e.deviceIdentityVerified) reasons.push("DEVICE_NOT_VERIFIED");
  if (!e.appleRegistered) reasons.push("APPLE_REGISTRATION_REQUIRED");

  const deviceUdid = canonicalUdid(e.deviceUdid);
  if (!deviceUdid) reasons.push("DEVICE_UDID_INVALID");
  const profileUdids = Array.isArray(e.profileUdids)
    ? e.profileUdids.map((value) => canonicalUdid(value))
    : [null];
  if (profileUdids.some((value) => !value)) {
    reasons.push("PROFILE_UDIDS_INVALID");
  } else if (deviceUdid && !profileUdids.includes(deviceUdid)) {
    reasons.push("DEVICE_NOT_IN_PROFILE");
  }

  if (!Number.isFinite(Date.parse(e.profileExpiresAt)) || Date.parse(e.profileExpiresAt) <= now.getTime()) {
    reasons.push("PROFILE_EXPIRED_OR_INVALID");
  }
  if (e.profileType !== "ad_hoc") reasons.push("PROFILE_NOT_AD_HOC");
  if (e.provisionsAllDevices) reasons.push("PROFILE_PROVISIONS_ALL_DEVICES");
  if (!e.profileTeamId || !e.artifactTeamId || e.profileTeamId !== e.artifactTeamId) {
    reasons.push("TEAM_MISMATCH");
  }

  if (!e.signatureVerified) reasons.push("SIGNATURE_NOT_VERIFIED");
  if (!e.nestedSignaturesPresent) reasons.push("NESTED_SIGNATURE_MISSING");
  if (!e.nestedTeamMatches) reasons.push("NESTED_TEAM_MISMATCH");
  if (!e.dylibDependenciesResolved) reasons.push("DYLIB_UNRESOLVED_DEPENDENCY");
  if (!Number.isFinite(Date.parse(e.signingCertificateExpiresAt)) ||
      Date.parse(e.signingCertificateExpiresAt) <= now.getTime()) {
    reasons.push("SIGNING_CERTIFICATE_EXPIRED_OR_INVALID");
  }
  if (e.signingCertificateRevoked) reasons.push("SIGNING_CERTIFICATE_REVOKED");
  if (!e.entitlementsMatch) reasons.push("ENTITLEMENTS_MISMATCH");
  if (!e.bundleId || e.bundleId !== e.profileBundleId) reasons.push("BUNDLE_MISMATCH");
  if (!e.distributionAuthorized) reasons.push("DISTRIBUTION_NOT_AUTHORIZED");
  return reasons;
}

/**
 * A row in manual_udid_requests is an intake request, not a device record.
 * Keep this adapter explicit so a future caller cannot accidentally promote
 * pending_unverified/reviewed_unverified input into OTA evidence.
 */
export function otaDenialsForManualUdidRequest(status: string): string[] {
  const reasons = ["DEVICE_NOT_APPROVED", "DEVICE_NOT_VERIFIED", "APPLE_REGISTRATION_REQUIRED"];
  if (status === "rejected") reasons.unshift("DEVICE_REJECTED");
  return reasons;
}
