import {
  SupabaseOtaEvidenceAdapter,
  type OtaDbClient,
} from "../../src/modules/ota/evidence-map";

/** Shared synthetic fixtures for the OTA evidence/flow tests. */

export const UDID = "A".repeat(40);
export const DEVICE_ID = "22222222-2222-4222-8222-222222222222";
export const VERSION_ID = "33333333-3333-4333-8333-333333333333";
export const APP_ID = "11111111-1111-4111-8111-111111111111";
export const ASSET_ID = "44444444-4444-4444-8444-444444444444";
export const PROFILE_ID = "55555555-5555-4555-8555-555555555555";
export const SHA = "a".repeat(64);

export type RowSet = Record<string, Array<Record<string, unknown>>>;

export function eligibleRows(): RowSet {
  return {
    devices: [{
      id: DEVICE_ID, status: "approved", identity_verified: true,
      apple_registered: true, udid_ciphertext: UDID,
      device_class: "iphone", apple_registered_year: 2026,
    }],
    app_versions: [{
      id: VERSION_ID, app_id: APP_ID, version: "1.0.2",
      bundle_id: "com.example.app", published: true, status: "published",
      provisioning_profile_id: PROFILE_ID, ipa_asset_id: ASSET_ID,
    }],
    apps: [{ id: APP_ID, name: "Example App", published: true }],
    ipa_assets: [{ id: ASSET_ID, sha256: SHA, object_key: "apps/example/1.0.2/app.ipa" }],
    distribution_channels: [{
      id: "66666666-6666-4666-8666-666666666666", version_id: VERSION_ID,
      channel: "ad_hoc", status: "published", rights_reviewed: true,
    }],
    provisioning_profiles: [{
      id: PROFILE_ID, team_id: "TEAM123456", bundle_id: "com.example.app",
      profile_type: "ad_hoc", provisions_all_devices: false,
      provisioned_udids: [UDID], expires_at: "2026-12-03T00:00:00Z",
    }],
    verifier_attestations: [{
      id: "77777777-7777-4777-8777-777777777777", asset_id: ASSET_ID,
      artifact_sha256: SHA, signature_verified: true,
      nested_signatures_present: true, nested_team_matches: true,
      dylib_dependencies_resolved: true, artifact_team_id: "TEAM123456",
      entitlements_match: true,
      signing_certificate_expires_at: "2027-01-01T00:00:00Z",
      signing_certificate_revoked: false, verified_at: "2026-11-04T00:00:00Z",
    }],
  };
}

/** Minimal PostgREST-shaped fake: `table?col=eq.value&...` filters only. */
export function fakeDb(rows: RowSet): OtaDbClient {
  return {
    async select(path: string) {
      const [table, query = ""] = path.split("?");
      const params = new URLSearchParams(query);
      let out = [...(rows[table] ?? [])];
      for (const [key, value] of params.entries()) {
        if (["select", "order", "limit"].includes(key)) continue;
        if (value.startsWith("eq.")) {
          const wanted = value.slice(3);
          out = out.filter((row) => String(row[key]) === wanted);
        }
      }
      const limit = Number(params.get("limit") ?? "0");
      return limit > 0 ? out.slice(0, limit) : out;
    },
  };
}

export function adapterFor(rows: RowSet, gate = { installEnabled: true, installPipelineReady: true }) {
  return new SupabaseOtaEvidenceAdapter(fakeDb(rows), {
    releaseGate: gate,
    // Fixtures store the canonical UDID directly as the "ciphertext".
    decryptUdid: (ciphertext) => ciphertext,
  });
}

