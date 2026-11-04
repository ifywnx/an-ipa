import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  VerifierAttestationError,
  parseVerifierAttestation,
  verifierAttestationToRow,
} from "../src/modules/ota/verifier";

const sample = JSON.parse(readFileSync(
  new URL("../workers/macos-verifier/fixtures/sample-evidence.json", import.meta.url),
  "utf8",
));
const ASSET_ID = "44444444-4444-4444-8444-444444444444";

test("the macOS worker sample output parses against the server contract", () => {
  const attestation = parseVerifierAttestation(sample);
  assert.equal(attestation.verifierId, "an-ipa-macos-verifier/1.0");
  assert.equal(attestation.signatureVerified, true);
  assert.equal(attestation.artifactTeamId, "TEAM123456");
  assert.equal(attestation.profileType, "ad_hoc");
});

test("the stored row matches the verifier_attestations migration columns", () => {
  const row = verifierAttestationToRow(parseVerifierAttestation(sample), ASSET_ID);
  assert.deepEqual(Object.keys(row).sort(), [
    "artifact_sha256", "artifact_team_id", "asset_id",
    "dylib_dependencies_resolved", "entitlements_match",
    "nested_signatures_present", "nested_team_matches",
    "signature_verified", "signing_certificate_expires_at",
    "signing_certificate_revoked", "verified_at", "verifier_id",
  ]);
  assert.equal(row.asset_id, ASSET_ID);
});

test("a verifier report may never claim install eligibility", () => {
  assert.throws(
    () => parseVerifierAttestation({ ...sample, install_eligible: true }),
    /VERIFIER_ELIGIBILITY_CLAIM/,
  );
});

test("malformed attestation fields fail closed", () => {
  assert.throws(
    () => parseVerifierAttestation({ ...sample, artifact_sha256: "xyz" }),
    /VERIFIER_HASH_INVALID/,
  );
  assert.throws(
    () => parseVerifierAttestation({ ...sample, signature_verified: "yes" }),
    VerifierAttestationError,
  );
  assert.throws(
    () => parseVerifierAttestation({ ...sample, verified_at: "whenever" }),
    /VERIFIER_TIME_INVALID/,
  );
  assert.throws(
    () => verifierAttestationToRow(parseVerifierAttestation(sample), "nope"),
    /VERIFIER_ASSET_ID_INVALID/,
  );
});
