# Implementation Plan — AN IPA STORE (LCSign on iPhone)

## Ground truth
`ifywnx/an-ipa` repository + dedicated Supabase project `an-ipa-store`. GitHub main stays protected. Database already has baseline migrations `platform_core`, `privacy_requests` and `harden_phase2_access`; **do not run the abandoned conflicting schema draft**. Existing Admin/Auth are UI placeholders only.

## Phase 2 — public store, Admin foundation [partial]
- Public browses multi-app catalog without login; Admin-only auth remains required.
- Mobile-first Admin sections for signed IPA import, versions/builds, UDID review, profile change/re-sign checklist.
- Configure verified Supabase Auth sessions, roles, CSRF, idempotency and per-user rate limits before enabling mutations.
- Real database RLS integration tests with distinct users; do not re-enable broad publisher permissions.

## Phase 3 — signed IPA ingestion [planned, staged code]
1. iPhone file picker accepts `.ipa`; client checks name/ZIP signature/size only (not signing).
2. Authenticated Admin gets a resumable/multipart upload grant for private quarantine; size/quota/sha256, MIME and path checks. Never upload via public bucket or write files to Git.
3. Isolated worker checks ZIP safety; extracts Info.plist and signed profile metadata (XML/binary plist). Reject malformed ZIP, path traversal, zip bombs, duplicate paths, expired profile and invalid entitlements.
4. Independent cryptographic verification of app signing and profile trust chain. If verifier unavailable or uncertain, remain blocked. Store immutable hash, report, verifier ID and time.
5. Admin reviews distribution rights and approves each version. Multiple apps, versions and certificates/profiles are supported. Never reuse an approval after IPA hash changes.

## Phase 4 — device registration [planned]
- No-login guest can submit manual UDID with explicit consent, anti-spam and proof-of-control workflow; status pending/unverified. Backend stores encrypted UDID + keyed HMAC for lookup, not plaintext public table.
- Apple-supported profile-service path only if CMS certificate trust, challenge TTL, atomic single-use, HTTPS, device identity and privacy are verified end-to-end. Do not simulate success.
- Admin sees masked identifiers and eligibility states; updates profile device list externally with legitimate Apple developer access.
- Owner imports new provisioning profile into LCSign on iPhone, re-signs existing app, uploads **new IPA** and re-verifies. Site never modifies IPA signing.

## Phase 5 — OTA installer [planned]
- Domain function builds XML OTA manifest and an itms-services URL only from a verified, server-issued short-lived grant.
- Server routes must reload verified IPA hash/profile/UDID/device Apple registration/entitlements and expiry. No unauthenticated "ask for any UDID and install" endpoint.
- Serve both manifest and artifact over HTTPS with proper content type and bounded access. Test on an authorized real iPhone.
- For non-Ad-Hoc distribution, establish Apple-allowed channel policy before activation.

## Phase 6 — security and release gate [blocked]
CI, unit and RLS integration, audit, secrets history scan, upload safety tests, trust-chain signature checks, rights review, Safari/real-device OTA tests, privacy deletion and grant revocation. Preview does not imply production approval.

## Out of scope
No MacBook signing, no cloud signing, no collection of P12/private key, no LCSign install required on guest devices. A purchased certificate with a one-year date alone does not prove rights to distribute arbitrary IPAs or to devices not provisioned.

## Operator requirements
Use LCSign locally on your own iPhone for each new signature; share only redacted metadata if troubleshooting. Configure R2, verified Auth and a separate verification service through hosting secret manager. Never send secrets into chat or GitHub.

## Phase 3 offline IPA inspection progress — 2026-11-03

- Implemented offline Python archive parser for signed LCSign IPA files: ZIP safety, binary/XML Info.plist, CMS integrity-only embedded.mobileprovision metadata, Ad Hoc UDID count, bundle/version/build checks.
- CI now executes synthetic malicious-archive and synthetic-CMS tests. This is *not* a web upload endpoint or trusted Apple code-sign verification.
- `docs/IPA_INSPECTION.md` describes worker isolation, missing Apple trust chain and prohibited OTA approval from inspection alone.

## Privacy/retention progress — 2026-11-03

- Supabase migration `purge_expired_device_intake` applied; service-role-only RPC can purge expired guest enrollment and manually submitted UDID requests.
- Added disabled-by-default `POST /api/internal/retention` protected by server-only bearer secret. Scheduling has **not been configured**.
- Still required: configured scheduler, end-to-end deletion tests and encrypted manual/admin lifecycle review.

**Final gate remains blocked:** Admin Auth/RBAC, real iPhone upload, trusted profile+code signature worker, Profile Service/SCEP and physical iPhone OTA tests.
