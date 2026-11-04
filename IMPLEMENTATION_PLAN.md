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

## Nested-code (dylib) inspection progress — 2026-11-05

- Owner confirmed **every IPA on the store is a dylib-injected (tweaked) build**. The quarantine inspector now inventories all nested Mach-O components (main executable, `.dylib`, `.framework`, `.appex`), reads each embedded CodeDirectory Team ID claim, cross-checks nested signature presence/team consistency, and resolves dylib load references against the bundle (substrate/jailbreak paths and missing `@rpath` targets fail as `DYLIB_UNRESOLVED_DEPENDENCY`).
- The sanitized scan report persists a bounded inventory for Admin review; the OTA policy denies with `NESTED_SIGNATURE_MISSING` / `NESTED_TEAM_MISMATCH` / `DYLIB_UNRESOLVED_DEPENDENCY` until a trusted verifier supplies the corresponding evidence.
- These are embedded-metadata checks only: CodeDirectory hashes, CMS signatures and the Apple chain are still **not** verified. The trusted Apple verification blocker (macOS `codesign --verify` incl. nested code) remains open, and all release flags stay closed.

## Privacy/retention progress — 2026-11-03

- Supabase migration `purge_expired_device_intake` applied; service-role-only RPC can purge expired guest enrollment and manually submitted UDID requests.
- Added disabled-by-default `POST /api/internal/retention` protected by server-only bearer secret. Scheduling has **not been configured**.
- Still required: configured scheduler, end-to-end deletion tests and encrypted manual/admin lifecycle review.

**Final gate remains blocked:** Admin Auth/RBAC, real iPhone upload, trusted profile+code signature worker, Profile Service/SCEP and physical iPhone OTA tests.

## Admin Auth and R2 quarantine pilot (2026-11-03)

- Admin password login API and server-side guarded routes implemented using verified Supabase Auth user and current roles table, encrypted short-lived session, no public signup. Hosting flags remain disabled until admin account / HTTPS WAF and rate-limit tests.
- R2 signed PUT API + mobile iPhone upload UI now exists, **disabled** by default, 100 MiB single-part pilot. Requires quarantine lifecycle, per-admin rate limits, R2 bucket+CORS and working automatic signature scanner; see `docs/R2_IPHONE_UPLOAD.md`.
- No upload success marks IPA installable; independent signer verification and Apple policy checks remain mandatory. Larger IPA require multipart/resumable.

## Phase 4 continuation — Vercel

Implemented durable Workflow + isolated Sandbox integration, service-only targeted
claims/cleanup RPCs, backoff, Admin health/history and synthetic runtime test.
Local build, 58 TypeScript tests, 16 Python tests and rollback SQL assertions pass.
Actual Vercel Sandbox synthetic suite passes. Preview Workflow → Sandbox and a complete synthetic R2 upload/replay/rejection/cleanup run now pass.
Phases 5–7 remain gated by trusted Apple verification, real IPA/iPhone tests,
R2 lifecycle and completion of application publication/permissions management.
No FINAL claim; no production/main change.

## Admin catalog continuation

Implemented authenticated draft create/edit/hide and audit history. Database RPC
checks a confirmed, non-banned Admin, rejects publication fields, limits mutations,
and prevents stale edits. Public catalog cannot read drafts or rights notes.
Rollback integration tests pass for all of those paths. Publishing and IPA linking
remain gated, with no manufactured signature/device evidence.

## OTA eligibility continuation — 2026-11-05

On local branch `codex/ota-eligibility` (not pushed, not part of PR #1 yet):
expanded the existing Phase 5 domain policy rather than replacing it. Added a
dual closed-by-default release gate, structured two-format UDID validation,
separate device-identity verification, Ad Hoc channel/profile checks, Team and
signing-certificate checks, grant/channel revocation and verifier-to-artifact
SHA-256 binding. Manual UDID requests remain `pending_unverified` intake
records and explicitly cannot become OTA evidence. See
`docs/OTA_ELIGIBILITY.md`.

This is code + unit tests only. No migration was added because the canonical
device/version/channel schema lives in the existing Supabase project and the
repository Phase 2 schema file is an obsolete no-op. No public manifest route,
persistent grant issuer, upload/publish/OTA enablement, merge or production
deployment was created. Trusted Apple verification, verified R2
lifecycle/CORS, real IPA upload, supported device enrollment and physical
iPhone OTA tests remain blockers.

## Code-complete continuation — 2026-11-05

Local branch `codex/ota-eligibility` (still NOT pushed, NOT merged; both OTA
flags still default `false`). The store is now code-complete: everything
that can be built and verified without real Apple assets, a real Mac, a
real iPhone or the live Supabase project exists and is tested
(TypeScript 128/128, Python 37/37, typecheck, production build and
security:check all green at the time of writing).

Implemented in this continuation:

- **Install grants + public OTA endpoints (A):** `install_grants` domain
  model (`src/modules/ota/grants.ts`) — hash-only bearer tokens, 10-minute
  reusable window (iOS fetches manifest and IPA separately; revocation is
  the kill switch), Admin-only issuance (`POST /api/ota/grants`), public
  `GET /api/ota/manifest/<token>` and `GET /api/ota/download/<token>`
  (302 to a presigned private-R2 GET, TTL ≤ 300s and ≤ grant remainder).
  Every fetch reloads the grant AND fresh evidence and re-runs
  `denyOtaGrant`; clients can never supply evidence. Closed flags deny at
  issuance and at fetch time with `OTA_INSTALL_DISABLED` /
  `OTA_INSTALL_PIPELINE_NOT_READY` and persist nothing.
- **Supabase evidence adapter (B):** `src/modules/ota/evidence-map.ts`
  (pure, fake-client tested) behind the server-only `evidence.ts`. Maps
  devices / versions / apps / assets / channels / provisioning_profiles /
  verifier_attestations into `OtaEvidence`, fail-closed on any missing or
  mismatched record (an attestation counts only when its SHA-256 equals
  the asset's). Schema assumptions and the reconciliation checklist are in
  the `evidence.ts` header. Migration
  `20261105090000_install_grants_and_verifier_attestations.sql` adds ONLY
  the two new tables, repo-convention style, and is **not applied**.
- **Profile intake (C):** `workers/profile_intake.py` verifies CMS content
  integrity and extracts Team ID, App ID/bundle (incl. wildcard), the full
  provisioned-UDID list, expiry and profile type as evidence (expired
  profiles are recorded, not hidden). `POST /api/admin/profiles/intake`
  stores the strictly validated report; the report can never claim Apple
  chain trust.
- **macOS verifier (D):** `workers/macos-verifier/` — ready to run on a
  Mac (`codesign --verify --deep --strict`, per-component Team checks,
  entitlements subset check, `security cms -D`, `security verify-cert`
  with OCSP attempt). Output parsers are fixture-tested on Linux; the
  package **has never run on a real Mac** and its evidence is not trusted
  until it does and an iPhone install confirms it. Attestations enter only
  via `POST /api/admin/verifier/attestations`.
- **Storefront (E):** `/devices` (browser-bound saved device + status,
  honest about there being no customer accounts yet), Apple quota panel on
  `/admin/udids` (recorded data only; explicit "chưa nối dữ liệu Apple"
  state instead of invented numbers), install checklist + FAQ on app
  detail pages, and three real policy pages marked as drafts pending the
  owner's legal review.

**Only human/real-environment steps remain** (none can be replaced by
code): (1) upload a real LCSign-signed IPA through the private intake;
(2) register a real device with Apple, regenerate the profile, re-sign in
LCSign; (3) run the macOS verifier on a real Mac and store its first real
attestation; (4) reconcile the adapter's schema assumptions against the
canonical Supabase project and apply the new migration; (5) verify R2
lifecycle/CORS on the real bucket; (6) physical iPhone OTA tests incl.
ineligible device, expired/revoked profile, revocation mid-window;
(7) owner approval of the draft policies, production domain, and only
then flipping the two OTA flags.

## Customer accounts continuation — 2026-11-05

Local branch `codex/ota-eligibility` (still NOT pushed, NOT merged;
`CUSTOMER_ACCOUNTS_ENABLED` defaults to `false`). The gap noted in the
storefront item above — "no customer accounts yet, devices are
browser-bound" — is now closed in code:

- **Accounts on Supabase Auth** (`src/modules/auth/customer.ts`,
  `customer-server.ts`): registration, password login, magic link and a
  Google authorize entry point, all behind the new flag + WAF gate. The
  customer session is a separate sealed cookie (`__Host-an-customer`,
  own `CUSTOMER_SESSION_KEY_B64`) and the module performs **no roles
  lookup** — confirmed, unbanned accounts are customers; Admin still
  requires its own cookie, key and roles check, so a customer session
  can never open Admin (source- and unit-tested). Identity is
  revalidated against `/auth/v1/user` per read; route handlers rotate
  expired access tokens via the sealed refresh token (30-day absolute
  cap). `/auth/callback` establishes sessions from fragment token pairs.
- **Ownership** (migration `20261105140000_customer_accounts.sql`,
  **not applied**): `user_id` on `manual_udid_requests` (both intake
  sources) and on `guest_enrollments` (the profile callback inherits the
  owner from the session row inside SQL). Signed-in submissions attach
  automatically; guest submissions are claimable later **only** from the
  same browser holding the intake cookie — claim RPCs match credential
  hashes on unowned rows, and no claim-by-UDID path exists. Access stays
  server-route + service-role scoped by the verified user id, plus a
  column-limited read-own RLS policy as defence in depth.
- **Surfaces:** `/login`, `/register`, `/account` (email, logout, claim,
  UDID-data deletion request), `/devices` account section, nav entry
  (hidden while the flag is off), Admin UDID queue with owner email or
  "Khách vãng lai", and pending deletion requests on `/admin/udids`.
  Deletion requests land in the new `customer_deletion_requests` table
  (the canonical `privacy_requests` schema is not recorded in this repo,
  so it is deliberately not written blind); processing is a documented
  manual operator flow in `docs/CUSTOMER_ACCOUNTS.md`.
- An account is bookkeeping only: it never changes a request's status,
  never verifies a device and never feeds OTA eligibility.

**Owner-only activation steps** (real project/dashboard): apply the
migration after canonical-history reconciliation; configure Supabase
Auth (email confirmation ON, redirect URL `<APP_ORIGIN>/auth/callback`,
rate limits, optional Google provider + OAuth credentials); set the new
env flags/key; run the real-device sign-up/sign-in/claim test pass
listed in `docs/CUSTOMER_ACCOUNTS.md`.
