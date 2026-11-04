# macOS verifier worker — AN IPA STORE

> **Status: READY TO RUN ON A MAC — NOT YET RUN, NOT YET TRUSTED.**
> This package was authored and unit-tested (output parsers, against
> recorded fixtures) on a Linux host. Its evidence only becomes trustworthy
> after it has actually run on a real Mac against a real LCSign-signed IPA
> and the result has been cross-checked by installing on a real iPhone.
> Until then the server treats every artifact as unverified and OTA stays
> closed. Do not describe this worker as "verified" in any user-facing copy.

## Why it exists

The Linux pipeline (`workers/ipa_inspector.py`) reads *declared* signature
metadata from Mach-O files and the embedded-profile CMS. It deliberately
never claims Apple signature validity. Only Apple's own tools on macOS can
answer that question, so trusted evidence comes from this worker and enters
the server exclusively through the Admin route
`POST /api/admin/verifier/attestations`, bound to the asset's SHA-256.

The owner signs IPAs with LCSign on iPhone. This worker never signs
anything and never sees a `.p12`, private key or password.

## Requirements

- A Mac (Apple silicon or Intel) with Xcode Command Line Tools
  (`xcode-select --install`) providing `codesign` and `security`.
- `openssl` (ships with macOS) for certificate expiry parsing.
- Python 3.11+ (system python3 is fine).
- Network access helps revocation (OCSP); offline runs still verify the
  chain but report `revocation_check: "unavailable"`.
- The quarantined IPA under test, obtained through the store's private
  intake — never a file received over chat or email.

## Run

```sh
cd workers/macos-verifier
python3 verify.py --ipa /path/to/quarantined/app.ipa --out evidence.json
# optional: --profile /path/to/profile.mobileprovision
```

Then submit `evidence.json` from the Admin side together with the asset id:

```json
POST /api/admin/verifier/attestations
{ "assetId": "<ipa_assets.id>", "attestation": { "...evidence.json..." } }
```

## What it checks

- `codesign --verify --deep --strict` on the extracted `.app`.
- Per-component `codesign -dvvv` Team IDs cross-checked against the
  inspector's nested-code inventory (every dylib/framework/appex signed,
  one consistent Team).
- App entitlements (`codesign -d --entitlements`) are a faithful subset of
  the profile entitlements; `get-task-allow` must be false.
- Profile decoded with `security cms -D`; bundle/team/expiry recorded.
- Signing certificate chain extracted with
  `codesign -d --extract-certificates`, validated with
  `security verify-cert -p codesigning`, revocation attempted via OCSP,
  expiry read with `openssl x509`.

Output fields match `src/modules/ota/verifier.ts` exactly
(`signature_verified`, `nested_signatures_present`, `nested_team_matches`,
`dylib_dependencies_resolved`, `entitlements_match`,
`signing_certificate_expires_at`, `signing_certificate_revoked`, ...).
`install_eligible` is always `false`: the server policy makes the final
decision from this evidence plus device/profile/gate records.

## Limits (read before trusting a report)

- `codesign --verify` validates the signature as macOS sees it today; a
  certificate revoked *after* verification, or an Apple-side change, can
  still break installation later. Re-verify close to release time.
- Revocation depends on OCSP reachability; `revocation_check:
  "unavailable"` means "not confirmed revoked", not "proven clean".
- A passing report does not prove the tweak dylibs behave well at runtime,
  only that they are present, signed by the same Team, and resolvable.
- First real run checklist for the owner: run against one real LCSign IPA,
  compare every field against `codesign` output by hand once, store the
  attestation, then attempt a real OTA install on the test iPhone with the
  profile containing that iPhone's UDID before trusting the pipeline.
