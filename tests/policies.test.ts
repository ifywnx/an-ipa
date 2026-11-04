import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidUdid, normalizeUdid, validateUdid, canTransition } from "../src/modules/devices/policy";
import {
  otaDenials,
  otaDenialsForManualUdidRequest,
  otaReleaseGateFromEnv,
  CLOSED_OTA_RELEASE_GATE,
  type OtaEvidence,
} from "../src/modules/distribution/policy";
import { UnconfiguredAppleAdapter } from "../src/modules/apple/adapter";

const now = new Date("2026-01-01T00:00:00Z");
const udid = "A".repeat(40);
const evidence: OtaEvidence = {
  deviceStatus: "approved",
  deviceIdentityVerified: true,
  appleRegistered: true,
  deviceUdid: udid,
  profileUdids: [udid],
  profileExpiresAt: "2026-02-01T00:00:00Z",
  profileType: "ad_hoc",
  provisionsAllDevices: false,
  profileTeamId: "TEAM123456",
  artifactTeamId: "TEAM123456",
  signatureVerified: true,
  nestedSignaturesPresent: true,
  nestedTeamMatches: true,
  dylibDependenciesResolved: true,
  signingCertificateExpiresAt: "2026-03-01T00:00:00Z",
  signingCertificateRevoked: false,
  entitlementsMatch: true,
  bundleId: "example.test",
  profileBundleId: "example.test",
  distributionAuthorized: true,
  channel: "ad_hoc",
  channelStatus: "published",
  grantRevoked: false,
  verifiedArtifactSha256: "b".repeat(64),
  releaseGate: { installEnabled: true, installPipelineReady: true },
};

test("format validation rejects arbitrary text", () => {
  assert.throws(() => normalizeUdid("not-a-device"));
  assert.equal(normalizeUdid("a".repeat(40)), "A".repeat(40));
});

test("UDID validation canonicalizes both accepted formats", () => {
  assert.deepEqual(validateUdid("a".repeat(40)), {
    valid: true,
    normalized: "A".repeat(40),
    format: "legacy_40_hex",
    reason: null,
  });
  assert.deepEqual(validateUdid("00008030-001a2b3c4d5e6f70"), {
    valid: true,
    normalized: "00008030-001A2B3C4D5E6F70",
    format: "modern_dashed",
    reason: null,
  });
  assert.equal(isValidUdid("00008030-001A2B3C4D5E6F70"), true);
});

test("UDID validation gives explicit reasons without accepting near misses", () => {
  assert.equal(validateUdid(undefined).reason, "UDID_MUST_BE_STRING");
  assert.equal(validateUdid("").reason, "UDID_EMPTY");
  assert.equal(validateUdid("A".repeat(20) + " " + "A".repeat(19)).reason, "UDID_CONTAINS_WHITESPACE");
  assert.equal(validateUdid("0000803-0001A2B3C4D5E6F70").reason, "UDID_DASHED_FORMAT_INVALID");
  assert.equal(validateUdid("A".repeat(39)).reason, "UDID_HEX_LENGTH_INVALID");
  assert.equal(validateUdid("Z".repeat(40)).reason, "UDID_INVALID_CHARACTERS");
  // The modern dash is significant; removing it must not create a legacy UDID.
  assert.equal(isValidUdid("00008030001A2B3C4D5E6F70"), false);
});

test("user and publisher cannot approve", () => {
  for (const role of ["user", "publisher", ""]) assert.equal(canTransition(role, "pending", "approved"), false);
});

test("revocation is terminal", () => {
  assert.equal(canTransition("admin", "approved", "revoked"), true);
  assert.equal(canTransition("admin", "revoked", "approved"), false);
});

test("OTA release gate is closed unless both exact server flags are true", () => {
  assert.deepEqual(otaReleaseGateFromEnv({}), CLOSED_OTA_RELEASE_GATE);
  assert.deepEqual(otaReleaseGateFromEnv({ OTA_INSTALL_ENABLED: "true" }), {
    installEnabled: true,
    installPipelineReady: false,
  });
  assert.deepEqual(otaReleaseGateFromEnv({
    OTA_INSTALL_ENABLED: "true",
    OTA_INSTALL_PIPELINE_READY: "true",
  }), { installEnabled: true, installPipelineReady: true });
  assert.deepEqual(otaReleaseGateFromEnv({
    OTA_INSTALL_ENABLED: "1",
    OTA_INSTALL_PIPELINE_READY: "yes",
  }), CLOSED_OTA_RELEASE_GATE);
});

test("synthetic complete evidence satisfies domain policy only", () => assert.deepEqual(otaDenials(evidence, now), []));

test("profile membership compares canonical UDIDs", () => {
  assert.deepEqual(otaDenials({
    ...evidence,
    deviceUdid: "a".repeat(40),
    profileUdids: ["A".repeat(40)],
  }, now), []);
});

test("manual UDID intake can never be promoted to OTA evidence", () => {
  for (const status of ["pending_unverified", "reviewed_unverified"]) {
    const reasons = otaDenialsForManualUdidRequest(status);
    assert.ok(reasons.includes("DEVICE_NOT_APPROVED"));
    assert.ok(reasons.includes("DEVICE_NOT_VERIFIED"));
    assert.ok(reasons.includes("APPLE_REGISTRATION_REQUIRED"));
  }
  assert.ok(otaDenialsForManualUdidRequest("rejected").includes("DEVICE_REJECTED"));
});

for (const [name, patch] of Object.entries({
  revoked: { deviceStatus: "revoked" },
  identityUnverified: { deviceIdentityVerified: false },
  unregistered: { appleRegistered: false },
  missingDevice: { profileUdids: [] },
  invalidDeviceUdid: { deviceUdid: "not-a-udid" },
  invalidProfileUdids: { profileUdids: ["not-a-udid"] },
  expiry: { profileExpiresAt: now.toISOString() },
  invalidDate: { profileExpiresAt: "invalid" },
  profileType: { profileType: "enterprise" },
  allDevices: { provisionsAllDevices: true },
  team: { artifactTeamId: "OTHERTEAM" },
  signature: { signatureVerified: false },
  nestedUnsigned: { nestedSignaturesPresent: false },
  nestedTeam: { nestedTeamMatches: false },
  dylibUnresolved: { dylibDependenciesResolved: false },
  certificateExpiry: { signingCertificateExpiresAt: now.toISOString() },
  certificateInvalidDate: { signingCertificateExpiresAt: "invalid" },
  certificateRevoked: { signingCertificateRevoked: true },
  entitlement: { entitlementsMatch: false },
  bundle: { bundleId: "other" },
  permission: { distributionAuthorized: false },
  channelDraft: { channelStatus: "draft" },
  channelRevoked: { channelStatus: "revoked" },
  unsupportedChannel: { channel: "enterprise" },
  grantRevoked: { grantRevoked: true },
  installDisabled: { releaseGate: { installEnabled: false, installPipelineReady: true } },
  pipelineNotReady: { releaseGate: { installEnabled: true, installPipelineReady: false } },
})) test(`OTA denies ${name}`, () => assert.ok(otaDenials({ ...evidence, ...patch }, now).length));

test("nested dylib findings deny with their specific codes", () => {
  assert.ok(otaDenials({ ...evidence, nestedSignaturesPresent: false }, now)
    .includes("NESTED_SIGNATURE_MISSING"));
  assert.ok(otaDenials({ ...evidence, nestedTeamMatches: false }, now)
    .includes("NESTED_TEAM_MISMATCH"));
  assert.ok(otaDenials({ ...evidence, dylibDependenciesResolved: false }, now)
    .includes("DYLIB_UNRESOLVED_DEPENDENCY"));
});

test("unconfigured Apple fails without simulated registration", async () => {
  await assert.rejects(new UnconfiguredAppleAdapter().registerDevice("synthetic", "test"), /APPLE_NOT_CONFIGURED/);
});
