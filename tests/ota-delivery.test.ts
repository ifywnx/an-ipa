import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SIGNED_GET_TTL_SECONDS,
  isSafeObjectKey,
  presignPrivateObjectGet,
} from "../src/modules/ota/delivery";
import type { PrivateR2 } from "../src/modules/ipa/r2-presign";

const cfg: PrivateR2 = {
  accountId: "a".repeat(32),
  bucket: "an-ipa-private",
  accessKeyId: "TESTACCESSKEY",
  secretAccessKey: "SYNTHETIC_SECRET_DO_NOT_USE",
};
const now = new Date("2026-11-05T00:00:00Z");

test("presigned GET targets the private bucket host with a bounded TTL", () => {
  const url = new URL(presignPrivateObjectGet(cfg, "apps/example/1.0.2/app.ipa", 300, now));
  assert.equal(url.hostname, "a".repeat(32) + ".r2.cloudflarestorage.com");
  assert.equal(url.pathname, "/an-ipa-private/apps/example/1.0.2/app.ipa");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
  assert.ok(url.searchParams.get("X-Amz-Signature"));
});

test("TTL above the cap and unsafe keys are rejected", () => {
  assert.throws(
    () => presignPrivateObjectGet(cfg, "apps/example/app.ipa", MAX_SIGNED_GET_TTL_SECONDS + 1, now),
    /R2_SIGNED_GET_TTL_OUT_OF_RANGE/,
  );
  assert.throws(() => presignPrivateObjectGet(cfg, "apps/example/app.ipa", 0, now),
    /R2_SIGNED_GET_TTL_OUT_OF_RANGE/);
  for (const key of ["../secret.ipa", "apps/../secret.ipa", "/absolute.ipa", "apps/./x.ipa", ""]) {
    assert.equal(isSafeObjectKey(key), false, key);
    assert.throws(() => presignPrivateObjectGet(cfg, key, 60, now), /R2_OBJECT_KEY_INVALID/);
  }
  assert.equal(isSafeObjectKey("apps/example/1.0.2/app.ipa"), true);
});

test("invalid storage configuration fails closed", () => {
  assert.throws(
    () => presignPrivateObjectGet({ ...cfg, secretAccessKey: "" }, "apps/x.ipa", 60, now),
    /R2_CONFIGURATION_INVALID/,
  );
});
