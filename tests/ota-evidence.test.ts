import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SupabaseOtaEvidenceAdapter,
  UNCONNECTED_APPLE_QUOTA,
  loadAppleQuotaSummary,
  summarizeAppleQuota,
  type OtaDbClient,
} from "../src/modules/ota/evidence-map";
import { CLOSED_OTA_RELEASE_GATE } from "../src/modules/distribution/policy";

import {
  DEVICE_ID, UDID, VERSION_ID, SHA,
  adapterFor, eligibleRows, fakeDb,
} from "./fixtures/ota";

test("adapter maps a complete record set to eligible evidence", async () => {
  const ctx = await adapterFor(eligibleRows()).loadInstallContext(DEVICE_ID, VERSION_ID);
  assert.ok(ctx);
  assert.equal(ctx.evidence.deviceStatus, "approved");
  assert.equal(ctx.evidence.deviceUdid, UDID);
  assert.deepEqual(ctx.evidence.profileUdids, [UDID]);
  assert.equal(ctx.evidence.signatureVerified, true);
  assert.equal(ctx.evidence.artifactTeamId, "TEAM123456");
  assert.equal(ctx.artifactVerified, true);
  assert.equal(ctx.artifactSha256, SHA);
  assert.equal(ctx.objectKey, "apps/example/1.0.2/app.ipa");
  assert.equal(ctx.channelId, "66666666-6666-4666-8666-666666666666");
});

test("adapter fails closed when the attestation table is empty (migration not applied)", async () => {
  const rows = eligibleRows();
  rows.verifier_attestations = [];
  const ctx = await adapterFor(rows).loadInstallContext(DEVICE_ID, VERSION_ID);
  assert.ok(ctx);
  assert.equal(ctx.artifactVerified, false);
  assert.equal(ctx.evidence.signatureVerified, false);
  assert.equal(ctx.evidence.artifactTeamId, "");
  assert.equal(ctx.evidence.signingCertificateExpiresAt, "");
});

test("an attestation for a different artifact hash never counts", async () => {
  const rows = eligibleRows();
  rows.verifier_attestations[0] = {
    ...rows.verifier_attestations[0], artifact_sha256: "b".repeat(64),
  };
  const ctx = await adapterFor(rows).loadInstallContext(DEVICE_ID, VERSION_ID);
  assert.equal(ctx?.artifactVerified, false);
  assert.equal(ctx?.evidence.nestedTeamMatches, false);
});

test("missing device or version yields no context at all", async () => {
  const adapter = adapterFor(eligibleRows());
  assert.equal(await adapter.loadInstallContext("99999999-9999-4999-8999-999999999999", VERSION_ID), null);
  assert.equal(await adapter.loadInstallContext(DEVICE_ID, "99999999-9999-4999-8999-999999999999"), null);
  assert.equal(await adapter.loadInstallContext("not-a-uuid", VERSION_ID), null);
});

test("without a decryptor the device UDID stays empty (denied downstream)", async () => {
  const adapter = new SupabaseOtaEvidenceAdapter(fakeDb(eligibleRows()), {
    releaseGate: { installEnabled: true, installPipelineReady: true },
  });
  const ctx = await adapter.loadInstallContext(DEVICE_ID, VERSION_ID);
  assert.equal(ctx?.evidence.deviceUdid, "");
});

test("closed gate is carried into evidence verbatim", async () => {
  const ctx = await adapterFor(eligibleRows(), CLOSED_OTA_RELEASE_GATE)
    .loadInstallContext(DEVICE_ID, VERSION_ID);
  assert.deepEqual(ctx?.evidence.releaseGate, CLOSED_OTA_RELEASE_GATE);
});

test("quota summary counts per class with the 100 ceiling and never invents data", () => {
  const summary = summarizeAppleQuota([
    { device_class: "iphone", apple_registered_year: 2026 },
    { device_class: "iphone", apple_registered_year: 2026 },
    { device_class: "ipad", apple_registered_year: 2026 },
    { device_class: "iphone", apple_registered_year: 2025 }, // other year: excluded
    { device_class: null, apple_registered_year: null },      // unknown year: counted
  ], 2026);
  assert.equal(summary.connected, true);
  assert.equal(summary.totalRegistered, 4);
  const iphone = summary.classes.find((c) => c.deviceClass === "iphone");
  assert.equal(iphone?.registered, 2);
  assert.equal(iphone?.limit, 100);
  assert.equal(iphone?.remaining, 98);
  assert.equal(summary.classes.find((c) => c.deviceClass === "unknown")?.registered, 1);
});

test("quota loader reads only apple-registered devices; unconnected shape is explicit", async () => {
  const summary = await loadAppleQuotaSummary(fakeDb(eligibleRows()), 2026);
  assert.equal(summary.totalRegistered, 1);
  assert.equal(summary.classes[0]?.deviceClass, "iphone");
  assert.equal(UNCONNECTED_APPLE_QUOTA.connected, false);
  assert.deepEqual(UNCONNECTED_APPLE_QUOTA.classes, []);
});
