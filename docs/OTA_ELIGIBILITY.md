# OTA eligibility — domain implementation status

**Status (2026-11-05): code and unit tests only. No public manifest/install
endpoint, no persistent install-grant issuer and no production enablement.**

## What already existed in PR #1

- `src/modules/distribution/policy.ts`: fail-closed OTA evidence checks for
  internal approval, Apple registration, profile membership/expiry, signature,
  entitlements, bundle and distribution authorization.
- `src/modules/ota/manifest.ts`: pure manifest + `itms-services://` builders
  with published-state, rights, hash-format, approved HTTPS host and short
  grant-expiry checks. There was deliberately no route using them.
- `src/modules/devices/policy.ts`: UDID syntax normalization and Admin-only
  device-state transitions.
- Manual UDID intake: `/udid/manual`, `POST/GET/DELETE /api/devices/manual`,
  encrypted `manual_udid_requests`, explicit consent, quotas and the fixed
  status `pending_unverified`.
- Guest Profile Service enrollment foundation: one-time challenge, encrypted
  UDID, trusted provider attestation and CMS verifier work. It proves neither
  Apple registration nor a persistent installable device by itself.
- `workers/ipa_inspector.py` plus the Vercel Sandbox worker: bounded ZIP,
  XML/binary plist and embedded-profile metadata inspection. This is the
  archive parser for this branch; no second Node ZIP/plist parser is used.

## Added on `codex/ota-eligibility`

### Explicit dual release gate

`OtaEvidence.releaseGate` is mandatory domain evidence and is built from
server configuration by `otaReleaseGateFromEnv`:

- `OTA_INSTALL_ENABLED=true`
- `OTA_INSTALL_PIPELINE_READY=true`

Only the exact string `true` opens either half. The default in
`.env.example` is `false` for both. Denials are `OTA_INSTALL_DISABLED` and
`OTA_INSTALL_PIPELINE_NOT_READY`. Opening configuration alone does not create
a route, grant, download URL or installation right; a future server caller
must still load trusted records and pass every evidence check.

### Expanded trusted-evidence checks

In addition to the checks already present, `otaDenials` now requires:

- independently verified device identity (`DEVICE_NOT_VERIFIED`), separate
  from internal Admin approval and from manual intake;
- valid canonical device/profile UDIDs (`DEVICE_UDID_INVALID`,
  `PROFILE_UDIDS_INVALID`, `DEVICE_NOT_IN_PROFILE`);
- an implemented, published distribution channel: currently only `ad_hoc`
  (`DISTRIBUTION_CHANNEL_NOT_SUPPORTED`, `CHANNEL_NOT_PUBLISHED`,
  `CHANNEL_REVOKED`);
- a non-revoked grant (`GRANT_REVOKED`);
- an Ad Hoc profile that does not provision all devices
  (`PROFILE_NOT_AD_HOC`, `PROFILE_PROVISIONS_ALL_DEVICES`);
- matching profile and artifact Team IDs (`TEAM_MISMATCH`);
- an unexpired, non-revoked signing certificate
  (`SIGNING_CERTIFICATE_EXPIRED_OR_INVALID`,
  `SIGNING_CERTIFICATE_REVOKED`).

### Nested-code (dylib) checks

Every store IPA is a dylib-injected build, so `OtaEvidence` also carries
three trusted-verifier findings about nested Mach-O code, all mandatory:

- every nested executable/dylib/framework/appex carries an embedded
  signature (`NESTED_SIGNATURE_MISSING`);
- all nested Team IDs match the main executable (`NESTED_TEAM_MISMATCH`);
- every dylib load reference resolves on a non-jailbroken device — no
  substrate/jailbreak paths and no `@rpath` targets missing from the bundle
  (`DYLIB_UNRESOLVED_DEPENDENCY`).

The quarantine inspector now inventories nested components and records the
embedded-metadata version of these findings in the scan report for Admin
review (see `docs/IPA_INSPECTION.md`). That scan reads declarations only; it
never sets these evidence fields by itself.

`buildOtaManifest` and `buildItmsServicesUrl` also bind the requested artifact
to the verifier's hash: a well-formed but different `artifactSha256` returns
`ARTIFACT_HASH_MISMATCH`.

### UDID validation and manual-intake boundary

`validateUdid` returns the canonical value, detected format and a stable
reason code for the two accepted formats:

- 40 hexadecimal characters;
- 8 hexadecimal characters, `-`, then 16 hexadecimal characters.

Canonical form is uppercase. The dash is significant; comparisons do not
strip punctuation. The manual page uses this shared validation as a
convenience before submission, while `/api/devices/manual` still repeats
validation on the server. The submission remains `pending_unverified`.

`otaDenialsForManualUdidRequest` makes the boundary executable: rows in
`manual_udid_requests` are intake records, not trusted device evidence, and
always deny OTA for lack of approval, identity verification and Apple
registration.

## Data-model decision

No migration was added in this change. The canonical `devices`,
`app_versions` and `distribution_channels` tables are part of the already
existing Supabase project history, while the repository's
`20261103000100_phase2_core.sql` is explicitly an obsolete no-op and must not
be replayed or extended with a competing schema. The applied manual-intake
migration already supplies the pending/unverified request model.

Before any endpoint is written, a server-only adapter must map service-role
records from the canonical project into `OtaEvidence`. Browser payloads must
never supply evidence fields such as `signatureVerified`, `profileUdids`,
`appleRegistered` or `deviceIdentityVerified`.

## Deliberate non-ports from the standalone scaffold

- **ZIP/plist parser:** not ported. The Python worker is already bounded,
  tested with synthetic malicious archives/CMS and integrated with the
  quarantine pipeline.
- **AltStore/Feather source feed:** not ported. A feed exposes direct IPA
  download URLs, while this architecture requires private R2 objects,
  per-device profile checks and short-lived server-issued grants. A public
  feed would bypass those boundaries.
- **Scaffold manifest:** not copied. PR #1's builder is stricter: approved
  hosts, grant expiry, publication/rights checks and now verifier-hash
  binding and the dual release gate.

## Still blocking any real OTA grant

1. Trusted Apple code-signing/profile-chain verification, including nested
   executables and a reliable signing-certificate status source.
2. A persistent server-side grant model/issuer and a route that reloads all
   evidence at grant and manifest time; neither exists yet.
3. Verified R2 lifecycle/CORS and delivery configuration for approved hosts.
4. A real owner-signed IPA upload through the private intake pipeline.
5. Supported verified-device enrollment and legitimate Apple device/profile
   regeneration, followed by re-signing in LCSign on the owner's iPhone.
6. Physical iPhone OTA tests, including an ineligible device, expired/revoked
   profile and revocation/expiry behaviour.

Until those gates pass, both OTA flags stay `false`, the app detail page
continues to show that website installation is unavailable, and no install
link is rendered.

## Addendum — code-complete state, 2026-11-05

The blockers listed above are narrowed, not removed. Now implemented in
code (branch `codex/ota-eligibility`, unpushed): the persistent grant
model + issuer and the evidence-reloading manifest/download routes
(former blocker 2), the server-only Supabase evidence adapter anticipated
by the data-model decision, the provisioning-profile intake worker that
supplies `provisioning_profiles` evidence, and the macOS verifier package
that is the intended source for former blocker 1's trusted evidence.
Former blockers 3–6 are unchanged: R2 lifecycle/CORS on the real bucket, a
real owner-signed IPA upload, legitimate Apple device registration +
profile regeneration + LCSign re-signing, and physical iPhone OTA tests
(ineligible device, expired/revoked profile, mid-window revocation) still
require the owner and real hardware. The verifier package is
fixture-tested only; it has never run on a Mac, so no signature evidence
is trusted yet. Both OTA flags remain `false`, and nothing in this
addendum authorizes enabling them.
