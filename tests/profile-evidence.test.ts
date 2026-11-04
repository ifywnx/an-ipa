import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ProfileEvidenceError,
  parseProfileEvidenceReport,
  profileEvidenceToRow,
} from "../src/modules/ota/profile-evidence";

/** Mirrors workers/profile_intake.py output for a synthetic ad hoc profile. */
function workerReport(overrides: Record<string, unknown> = {}) {
  return {
    uuid: "SYNTHETIC-NOT-APPLE",
    team_id: "TEAM123456",
    team_ids: ["TEAM123456"],
    application_identifier: "TEAM123456.com.example.signedapp",
    bundle_id: "com.example.signedapp",
    bundle_wildcard: false,
    profile_type: "ad_hoc",
    provisions_all_devices: false,
    provisioned_udids: ["A".repeat(40), "00008110-001234567890001E"],
    provisioned_device_count: 2,
    expires_at: "2027-03-01T00:00:00+00:00",
    expired: false,
    get_task_allow: false,
    cms_content_integrity: true,
    apple_signer_chain_trusted: false,
    evidence_source: "profile_intake_untrusted_metadata",
    install_eligible: false,
    ...overrides,
  };
}

test("worker report parses into typed evidence and an adapter-ready row", () => {
  const evidence = parseProfileEvidenceReport(workerReport());
  assert.equal(evidence.teamId, "TEAM123456");
  assert.equal(evidence.bundleId, "com.example.signedapp");
  assert.equal(evidence.provisionedUdids.length, 2);
  const row = profileEvidenceToRow(evidence);
  assert.deepEqual(Object.keys(row).sort(), [
    "bundle_id", "expires_at", "profile_type", "provisioned_udids",
    "provisions_all_devices", "team_id", "uuid",
  ]);
  assert.equal(row.expires_at, "2027-03-01T00:00:00.000Z");
});

test("lowercase UDIDs from a profile are canonicalized", () => {
  const evidence = parseProfileEvidenceReport(
    workerReport({ provisioned_udids: ["a".repeat(40)] }),
  );
  assert.deepEqual(evidence.provisionedUdids, ["A".repeat(40)]);
});

test("any trust or eligibility claim in a report is rejected outright", () => {
  for (const overrides of [
    { apple_signer_chain_trusted: true },
    { install_eligible: true },
    { cms_content_integrity: false },
    { evidence_source: "somewhere_else" },
  ]) {
    assert.throws(() => parseProfileEvidenceReport(workerReport(overrides)), ProfileEvidenceError);
  }
});

test("malformed fields fail closed with stable codes", () => {
  assert.throws(
    () => parseProfileEvidenceReport(workerReport({ provisioned_udids: ["junk"] })),
    /PROFILE_EVIDENCE_DEVICES_INVALID/,
  );
  assert.throws(
    () => parseProfileEvidenceReport(workerReport({ expires_at: "not a date" })),
    /PROFILE_EVIDENCE_EXPIRY_INVALID/,
  );
  assert.throws(
    () => parseProfileEvidenceReport(workerReport({ bundle_id: "no dots here" })),
    /PROFILE_EVIDENCE_BUNDLE_INVALID/,
  );
  assert.throws(() => parseProfileEvidenceReport(null), /PROFILE_EVIDENCE_NOT_AN_OBJECT/);
  assert.throws(() => parseProfileEvidenceReport("nope"), /PROFILE_EVIDENCE_NOT_AN_OBJECT/);
});

test("wildcard profiles parse with a null bundle id", () => {
  const evidence = parseProfileEvidenceReport(
    workerReport({ bundle_id: null, bundle_wildcard: true }),
  );
  assert.equal(evidence.bundleId, null);
  assert.equal(evidence.bundleWildcard, true);
});
