import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryInstallGrantRepository,
  type InstallGrantRecord,
} from "../src/modules/ota/grants";
import {
  issueInstallGrant,
  loadGrantAccess,
  serveOtaDownload,
  serveOtaManifest,
  type OtaFlowDeps,
} from "../src/modules/ota/flow";
import { sha256 } from "../src/modules/enrollment/secure";
import {
  DEVICE_ID,
  VERSION_ID,
  adapterFor,
  eligibleRows,
  type RowSet,
} from "./fixtures/ota";

const T0 = new Date("2026-11-05T00:00:00Z");
const OPEN_GATE = { installEnabled: true, installPipelineReady: true };
const CLOSED_GATE = { installEnabled: false, installPipelineReady: false };

class CountingRepo extends InMemoryInstallGrantRepository {
  inserts = 0;
  override async insert(record: InstallGrantRecord): Promise<void> {
    this.inserts += 1;
    return super.insert(record);
  }
}

function makeDeps(rows: RowSet, gate = OPEN_GATE) {
  const repo = new CountingRepo();
  const clock = { now: new Date(T0) };
  const presignCalls: Array<{ key: string; ttl: number }> = [];
  const deps: OtaFlowDeps = {
    grants: repo,
    adapter: adapterFor(rows, gate),
    appOrigin: "https://store.example.test",
    deliveryHosts: ["store.example.test"],
    presignGet: (objectKey, ttlSeconds) => {
      presignCalls.push({ key: objectKey, ttl: ttlSeconds });
      return "https://storage.example.test/" + objectKey + "?ttl=" + ttlSeconds;
    },
    now: () => clock.now,
  };
  return { deps, repo, clock, presignCalls };
}

test("issuance persists only a hash and returns a one-time raw token", async () => {
  const { deps, repo } = makeDeps(eligibleRows());
  const result = await issueInstallGrant(deps, { deviceId: DEVICE_ID, versionId: VERSION_ID });
  assert.ok(result.ok);
  assert.match(result.token, /^[A-Za-z0-9_-]{40,64}$/);
  const stored = await repo.findByTokenHash(sha256(result.token));
  assert.equal(stored?.id, result.record.id);
  assert.equal(await repo.findByTokenHash(result.token), null);
  assert.match(result.manifestUrl, /^https:\/\/store\.example\.test\/api\/ota\/manifest\//);
  assert.match(result.itmsServicesUrl, /^itms-services:\/\//);
});

test("with flags closed issuance denies with gate codes and persists nothing", async () => {
  const { deps, repo } = makeDeps(eligibleRows(), CLOSED_GATE);
  const result = await issueInstallGrant(deps, { deviceId: DEVICE_ID, versionId: VERSION_ID });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.denials.includes("OTA_INSTALL_DISABLED"));
    assert.ok(result.denials.includes("OTA_INSTALL_PIPELINE_NOT_READY"));
  }
  assert.equal(repo.inserts, 0);
});

test("manifest serves inside the window and iOS-style reuse keeps working", async () => {
  const { deps, repo } = makeDeps(eligibleRows());
  const issued = await issueInstallGrant(deps, { deviceId: DEVICE_ID, versionId: VERSION_ID });
  assert.ok(issued.ok);
  const first = await serveOtaManifest(deps, issued.token);
  assert.ok(first.ok);
  assert.match(first.body, /com\.example\.app/);
  assert.match(first.body, /api\/ota\/download\//);
  const second = await serveOtaManifest(deps, issued.token);
  assert.ok(second.ok); // manifest is fetched more than once by iOS
  const stored = await repo.findByTokenHash(sha256(issued.token));
  assert.equal(stored?.useCount, 2);
});

test("download redirects to a short-lived signed URL bounded by the grant window", async () => {
  const { deps, presignCalls } = makeDeps(eligibleRows());
  const issued = await issueInstallGrant(deps, { deviceId: DEVICE_ID, versionId: VERSION_ID });
  assert.ok(issued.ok);
  const result = await serveOtaDownload(deps, issued.token);
  assert.ok(result.ok);
  assert.equal(result.status, 302);
  assert.match(result.location, /^https:\/\/storage\.example\.test\/apps\/example\/1\.0\.2\/app\.ipa/);
  assert.equal(presignCalls.length, 1);
  assert.ok(presignCalls[0].ttl >= 1 && presignCalls[0].ttl <= 300);
});

test("revocation between manifest and download blocks the download", async () => {
  const { deps, repo, clock } = makeDeps(eligibleRows());
  const issued = await issueInstallGrant(deps, { deviceId: DEVICE_ID, versionId: VERSION_ID });
  assert.ok(issued.ok);
  assert.ok((await serveOtaManifest(deps, issued.token)).ok);
  await repo.revoke(issued.record.id, clock.now);
  const blocked = await serveOtaDownload(deps, issued.token);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.ok(blocked.denials.includes("GRANT_REVOKED"));
});

test("an expired grant answers 410 and cannot serve a manifest", async () => {
  const { deps, clock } = makeDeps(eligibleRows());
  const issued = await issueInstallGrant(deps, { deviceId: DEVICE_ID, versionId: VERSION_ID });
  assert.ok(issued.ok);
  clock.now = new Date(T0.getTime() + 11 * 60_000);
  const result = await serveOtaManifest(deps, issued.token);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 410);
    assert.ok(result.denials.includes("GRANT_EXPIRED"));
  }
});

test("evidence revoked after issuance (attestation flipped) denies the next fetch", async () => {
  const rows = eligibleRows();
  const { deps } = makeDeps(rows);
  const issued = await issueInstallGrant(deps, { deviceId: DEVICE_ID, versionId: VERSION_ID });
  assert.ok(issued.ok);
  rows.verifier_attestations[0] = {
    ...rows.verifier_attestations[0], signing_certificate_revoked: true,
  };
  const result = await serveOtaManifest(deps, issued.token);
  assert.equal(result.ok, false);
});

test("artifact replaced after issuance is a 409, never silently followed", async () => {
  const rows = eligibleRows();
  const { deps } = makeDeps(rows);
  const issued = await issueInstallGrant(deps, { deviceId: DEVICE_ID, versionId: VERSION_ID });
  assert.ok(issued.ok);
  rows.ipa_assets[0] = { ...rows.ipa_assets[0], sha256: "b".repeat(64) };
  rows.verifier_attestations[0] = {
    ...rows.verifier_attestations[0], artifact_sha256: "b".repeat(64),
  };
  const access = await loadGrantAccess(deps, issued.token);
  assert.equal(access.ok, false);
  if (!access.ok) {
    assert.equal(access.status, 409);
    assert.ok(access.denials.includes("ARTIFACT_HASH_MISMATCH"));
  }
});

test("unknown and malformed tokens fail closed", async () => {
  const { deps } = makeDeps(eligibleRows());
  const malformed = await loadGrantAccess(deps, "short");
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.status, 400);
  const unknown = await loadGrantAccess(deps, "U".repeat(43));
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.status, 404);
});
