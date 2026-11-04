# AN IPA STORE

iPhone-first, public catalog for legally distributable iOS apps. The owner signs authorized IPA files **on their own iPhone with LCSign**. Guests do not log in or install LCSign. The site does **not** sign IPA or collect P12, private keys or Apple certificate passwords.

## Status (2026-11-03)

- Public app catalog, detail pages and premium `/udid` Safari guide.
- Admin shell for signed IPA preflight on iPhone, UDID workflow and per-app versions. Private upload and admin mutations **not enabled**.
- Guest enrollment challenge API and database: random one-time token, 8-minute expiry, atomic consumption, browser HttpOnly cookie, encrypted UDID and Ed25519 provider-signed attestation verification. **Profile download is disabled until a real Apple-compliant Profile Service CMS/SCEP verifier is connected and tested on an actual iPhone.**
- Pure OTA manifest builder and denial tests. No public install/manifest endpoint or IPA download currently exists.
- Supabase project `an-ipa-store` has current migrations `platform_core`, `privacy_requests`, `harden_phase2_access`, and `guest_enrollment_verified_provider_foundation`. All guest enrollment data is inaccessible directly to browser roles.
- No production deployment approved. GitHub `main` unchanged; code under `codex/bootstrap-an-ipa-store` and PR #1.

## Local checks

Node >= 22.

```sh
npm ci
cp .env.example .env.local
npm run dev
npm test
npm run typecheck
npm run build
npm run security:check
npm audit --omit=dev
```

## Routes

- `/apps`: public published applications.
- `/udid`: Safari enrollment guide, consent, actual server status and copy after provider verified.
- `/devices/register`: manual path explanation, no submission until encrypted persistence is available.
- `/admin`: read-only mobile admin shell.
- `/admin/ipa`: signed IPA local preflight; **does not upload**.
- `/admin/ipa/versions`: version management shell.
- `/admin/udids`: device management shell.

## Safety boundaries and next steps

See `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `docs/ENROLLMENT_PROTOCOL.md` and `docs/LCSIGN_IPHONE_WORKFLOW.md`. An Apple OTA Profile Service is not a normal mobileconfig; a working provider must verify CMS and complete the real protocol. Apple documentation for that flow is archived, so modern iPhone compatibility needs physical-device testing.

Only publish verified signed IPA after archive scanning, provisioning profile/team/entitlement checks and allowed rights are confirmed. Device UDID in the same signed Ad Hoc profile is mandatory, alongside Apple registration. Never claim a completed installation from a click or a manually typed UDID.

No secrets, UDIDs, IPA, profile, P12 or private keys are committed to GitHub. Deploy production only after security gates and test-device approval.

## Incremental progress: IPA inspector & expiry purge

`workers/ipa_inspector.py` provides a quarantined-file-only metadata scan; archive extraction and real IPA upload are **not exposed**. Synthetic fixtures are exercised in GitHub Actions. Even a successful scan must not unlock installation because embedded profile issuer chain, iOS app code signature and device entitlement have not been independently checked.

The Supabase project has a service-only `purge_expired_device_intake` RPC. The `/api/internal/retention` route is present but disabled until a trusted scheduler and secret manager are configured and verified. No production deployment.
