import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INSTALL_GRANT_TTL_MS,
  INSTALL_GRANT_MIN_TTL_MS,
  InMemoryInstallGrantRepository,
  buildInstallGrantRecord,
  installGrantRecordDenials,
  installGrantStatusAt,
  isUuid,
  type InstallGrantRecord,
} from "../src/modules/ota/grants";
import { sha256 } from "../src/modules/enrollment/secure";

const T0 = new Date("2026-11-05T00:00:00Z");
const DEVICE_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const SHA = "a".repeat(64);
const TOKEN = "T".repeat(43);

function build(overrides = {}) {
  return buildInstallGrantRecord({
    deviceId: DEVICE_ID,
    versionId: VERSION_ID,
    artifactSha256: SHA,
    now: T0,
    token: TOKEN,
    ...overrides,
  });
}

test("only the SHA-256 hash of the bearer token is stored", () => {
  const { record, token } = build();
  assert.equal(token, TOKEN);
  assert.equal(record.tokenHash, sha256(TOKEN));
  assert.notEqual(record.tokenHash, TOKEN);
  assert.ok(!JSON.stringify(record).includes(TOKEN));
});

test("default TTL is the 10-minute policy cap; out-of-range TTLs are rejected", () => {
  const { record } = build();
  assert.equal(Date.parse(record.expiresAt) - Date.parse(record.issuedAt), INSTALL_GRANT_TTL_MS);
  assert.throws(() => build({ ttlMs: INSTALL_GRANT_MIN_TTL_MS - 1 }), /INSTALL_GRANT_TTL_OUT_OF_RANGE/);
  assert.throws(() => build({ ttlMs: INSTALL_GRANT_TTL_MS + 1 }), /INSTALL_GRANT_TTL_OUT_OF_RANGE/);
  assert.throws(() => build({ ttlMs: 90_000.5 }), /INSTALL_GRANT_TTL_OUT_OF_RANGE/);
});

test("identifiers and artifact hash are strictly validated", () => {
  assert.throws(() => build({ deviceId: "nope" }), /INSTALL_GRANT_DEVICE_ID_INVALID/);
  assert.throws(() => build({ versionId: "nope" }), /INSTALL_GRANT_VERSION_ID_INVALID/);
  assert.throws(() => build({ artifactSha256: "zz" }), /INSTALL_GRANT_ARTIFACT_HASH_INVALID/);
  assert.throws(() => build({ token: "short" }), /INSTALL_GRANT_TOKEN_INVALID/);
  assert.ok(isUuid(DEVICE_ID));
  assert.ok(!isUuid("22222222-2222-4222-8222"));
});

test("status lifecycle: active inside the window, expired after, revoked wins", () => {
  const { record } = build({ ttlMs: 60_000 });
  assert.equal(installGrantStatusAt(record, new Date(T0.getTime() + 30_000)), "active");
  assert.equal(installGrantStatusAt(record, new Date(T0.getTime() + 61_000)), "expired");
  const revoked: InstallGrantRecord = { ...record, status: "revoked" };
  assert.equal(installGrantStatusAt(revoked, new Date(T0.getTime() + 30_000)), "revoked");
  assert.deepEqual(installGrantRecordDenials(record, new Date(T0.getTime() + 30_000)), []);
  assert.deepEqual(installGrantRecordDenials(record, new Date(T0.getTime() + 61_000)), ["GRANT_EXPIRED"]);
  assert.deepEqual(installGrantRecordDenials(revoked, T0), ["GRANT_REVOKED"]);
  assert.deepEqual(installGrantRecordDenials(null, T0), ["GRANT_NOT_FOUND"]);
});

test("in-memory repository: window reuse, use counting, revoke, duplicates", async () => {
  const repo = new InMemoryInstallGrantRepository();
  const { record } = build({ ttlMs: 60_000 });
  await repo.insert(record);
  await assert.rejects(() => repo.insert(record), /INSTALL_GRANT_DUPLICATE/);

  const found = await repo.findByTokenHash(sha256(TOKEN));
  assert.equal(found?.id, record.id);
  assert.equal(await repo.findByTokenHash(TOKEN), null); // raw token never resolves

  await repo.markUsed(record.id, new Date(T0.getTime() + 10_000));
  await repo.markUsed(record.id, new Date(T0.getTime() + 20_000));
  const used = await repo.findByTokenHash(sha256(TOKEN));
  assert.equal(used?.useCount, 2);
  assert.equal(used?.firstUsedAt, new Date(T0.getTime() + 10_000).toISOString());
  assert.equal(used?.lastUsedAt, new Date(T0.getTime() + 20_000).toISOString());
  // Reuse inside the window is by design (manifest + IPA are separate fetches).
  assert.equal(installGrantStatusAt(used as InstallGrantRecord, new Date(T0.getTime() + 30_000)), "active");

  assert.equal(await repo.revoke(record.id, new Date(T0.getTime() + 30_000)), true);
  assert.equal(await repo.revoke(record.id, new Date(T0.getTime() + 31_000)), false);
  const after = await repo.findByTokenHash(sha256(TOKEN));
  assert.equal(after?.status, "revoked");
  assert.ok(after?.revokedAt);
});
