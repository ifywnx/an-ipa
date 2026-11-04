import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOtaManifest, buildItmsServicesUrl, denyOtaGrant, OtaDenied, type VerifiedOtaGrant } from "../src/modules/ota/manifest";
import type { OtaEvidence } from "../src/modules/distribution/policy";

const now = new Date("2026-11-03T00:00:00Z");
const udid = "A".repeat(40);
const evidence: OtaEvidence = {
  deviceStatus: "approved",
  deviceIdentityVerified: true,
  appleRegistered: true,
  deviceUdid: udid,
  profileUdids: [udid],
  profileExpiresAt: "2026-12-03T00:00:00Z",
  profileType: "ad_hoc",
  provisionsAllDevices: false,
  profileTeamId: "TEAM123456",
  artifactTeamId: "TEAM123456",
  signatureVerified: true,
  nestedSignaturesPresent: true,
  nestedTeamMatches: true,
  dylibDependenciesResolved: true,
  signingCertificateExpiresAt: "2027-01-01T00:00:00Z",
  signingCertificateRevoked: false,
  entitlementsMatch: true,
  bundleId: "com.example.app",
  profileBundleId: "com.example.app",
  distributionAuthorized: true,
  channel: "ad_hoc",
  channelStatus: "published",
  grantRevoked: false,
  verifiedArtifactSha256: "a".repeat(64),
  releaseGate: { installEnabled: true, installPipelineReady: true },
};
const grant: VerifiedOtaGrant = {
  evidence,
  appPublished: true,
  versionPublished: true,
  artifactVerified: true,
  distributionRightsReviewed: true,
  artifactSha256: "a".repeat(64),
  bundleIdentifier: "com.example.app",
  version: "1.0.2",
  title: "Example & Demo",
  ipaUrl: "https://ipa.example.test/build.ipa?signature=synthetic&expires=123",
  manifestUrl: "https://app.example.test/manifest/123.plist?signature=synthetic",
  grantExpiresAt: "2026-11-03T00:05:00Z",
};
const hosts = ["ipa.example.test", "app.example.test"];

test("synthetic verified grant renders escaped plist with HTTPS IPA", () => {
  const xml = buildOtaManifest(grant, hosts, now);
  assert.match(xml, /software-package/);
  assert.match(xml, /Example &amp; Demo/);
  assert.match(xml, /signature=synthetic&amp;expires=123/);
  assert.match(buildItmsServicesUrl(grant, hosts, now), /^itms-services:\/\/\?action=download-manifest&url=https%3A%2F%2F/);
});

test("closed OTA flags are a hard denial even for otherwise complete evidence", () => {
  const installDisabled: VerifiedOtaGrant = {
    ...grant,
    evidence: { ...evidence, releaseGate: { installEnabled: false, installPipelineReady: true } },
  };
  assert.ok(denyOtaGrant(installDisabled, hosts, now).includes("OTA_INSTALL_DISABLED"));
  assert.throws(() => buildOtaManifest(installDisabled, hosts, now), OtaDenied);
  assert.throws(() => buildItmsServicesUrl(installDisabled, hosts, now), OtaDenied);

  const pipelineNotReady: VerifiedOtaGrant = {
    ...grant,
    evidence: { ...evidence, releaseGate: { installEnabled: true, installPipelineReady: false } },
  };
  assert.ok(denyOtaGrant(pipelineNotReady, hosts, now).includes("OTA_INSTALL_PIPELINE_NOT_READY"));
  assert.throws(() => buildOtaManifest(pipelineNotReady, hosts, now), OtaDenied);
});

test("unsigned, unregistered, missing device or expired profile all fail closed", () => {
  for (const change of [
    { artifactVerified: false },
    { evidence: { ...evidence, signatureVerified: false } },
    { evidence: { ...evidence, appleRegistered: false } },
    { evidence: { ...evidence, profileUdids: [] } },
    { evidence: { ...evidence, profileExpiresAt: "2026-01-01T00:00:00Z" } },
    { distributionRightsReviewed: false },
    { grantExpiresAt: "2026-11-03T03:00:00Z" },
    { ipaUrl: "http://ipa.example.test/untrusted.ipa" },
    { ipaUrl: "https://evil.example.test/app.ipa" },
  ]) assert.throws(() => buildOtaManifest({ ...grant, ...change }, hosts, now), OtaDenied);
});

test("grant cannot be redirected to another artifact, team, channel or revoked grant", () => {
  assert.ok(denyOtaGrant({ ...grant, artifactSha256: "b".repeat(64) }, hosts, now)
    .includes("ARTIFACT_HASH_MISMATCH"));
  for (const change of [
    { evidence: { ...evidence, artifactTeamId: "OTHERTEAM" } },
    { evidence: { ...evidence, signingCertificateRevoked: true } },
    { evidence: { ...evidence, channelStatus: "revoked" } },
    { evidence: { ...evidence, grantRevoked: true } },
    { evidence: { ...evidence, deviceIdentityVerified: false } },
    { evidence: { ...evidence, profileType: "enterprise" } },
  ]) assert.throws(() => buildOtaManifest({ ...grant, ...change }, hosts, now), OtaDenied);
});

test("rejects XML control chars and untrusted host", () => {
  assert.ok(denyOtaGrant({ ...grant, title: "bad\u0000name" }, hosts, now).length > 0);
  assert.ok(denyOtaGrant(grant, [], now).length > 0);
});
