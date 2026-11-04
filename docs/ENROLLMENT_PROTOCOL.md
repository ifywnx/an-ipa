# iPhone UDID enrollment — real protocol and security gates

## Research / distinction from MDM

Apple's [archived Profile Service documentation](https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/iPhoneOTAConfiguration/profile-service/profile-service.html) describes an OTA Profile Service payload (literal type `Profile Service`, URL, DeviceAttributes, Challenge). When the person opts in and installs it, the device sends an Apple device-identity-signed CMS response containing UDID and challenge. The archived **full workflow also requires PKI/SCEP and follow-on profile exchange**; it is not equivalent to a vanilla mobileconfig or JavaScript.

MDM Device Enrollment is a different, more powerful protocol with its own infrastructure and user prompts. We do not request MDM solely to collect UDID without an established operational need. As the Profile Service guide is archived, iOS 26+ compatibility must be proven using a real, authorized iPhone before activation.

## Implemented in source and Supabase

- Premium `/udid` Safari UI with consent, Apple Settings instructions, server status polling and copy control **only after cryptographically verified callback**.
- `POST /api/enrollment/start`: 32-byte browser token in short-lived Secure HttpOnly cookie; independent challenge; hash-only database records, expiry 8 min; source-IP based rate limit in atomic SQL (3/hr). No fake mobileconfig.
- `POST /api/enrollment/verified-callback`: **accepts only provider-signed Ed25519 attestations** from pre-configured trusted enrollment verifier, with issuer+audience+timestamp+challenge checks. Provider must have independently verified the actual Apple CMS signature, Apple device certificate chain and phase completion before signing. This app does **not** itself parse or validate CMS.
- Atomic `complete_guest_enrollment` RPC rejects expired/reused challenges; only `service_role` may call it.
- `GET /api/enrollment/status` decrypts UDID only for the browser holding a valid HttpOnly session cookie; no anonymous database access. UDID encrypted AES-256-GCM and indexed via keyed HMAC.
- Supabase migration `20261102211217_guest_enrollment_verified_provider_foundation.sql` is applied to dedicated project; no browser read/write grants.
- All server APIs return 503 unless **all** enrollment settings are explicitly configured and trusted WAF/edge is ready. In provider mode the profile download is served by a separate, real Apple-compliant enrollment provider; the app itself never synthesizes a profile **for that mode**.
- Optional pragmatic self-profile mode (separate flag, default off — see the dedicated section below): the store serves its own Profile Service `.mobileconfig` and accepts the device response itself at a strictly lower, honestly labelled trust level (`device_reported` → `pending_unverified`). It never feeds the verified path above.

## Required production configuration (all in hosting secret manager)

- `ENROLLMENT_ENABLED=true` and `ENROLLMENT_WAF_READY=true` only after testing.
- `APP_ORIGIN`: actual HTTPS origin matching browser.
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SECRET_KEY`: server-only secret key. Never in JS bundle or source control.
- `ENROLLMENT_UDID_ENCRYPTION_KEY_B64`: 32-byte symmetric AES key, base64 (KMS/managed secret), not a signing/private certificate key.
- `ENROLLMENT_PROVIDER_START_URL`: HTTPS address of **real** Profile Service that produces device enrollment profiles and verifies all CMS/SCEP phases.
- `ENROLLMENT_PROVIDER_ISSUER`: exact issuer string in verifier assertions.
- `ENROLLMENT_PROVIDER_PUBLIC_KEY_B64`: DER/SPKI Ed25519 PUBLIC key of provider's assertion signer; its private key stays with provider.
- `ENROLLMENT_TRUSTED_IP_HEADER`: only a source-IP header sanitized by a trusted proxy/WAF, never an arbitrary client-supplied header.
- Provider must issue signed JSON assertions to `/api/enrollment/verified-callback` with header `x-verified-device-signature`, over the **exact UTF-8 JSON request body**. Fields: `protocol=apple-profile-service-cms-v1`, `issuer`, `audience=APP_ORIGIN`, `challenge`, `udid`, ISO `issued_at`, `provider_reference`, `device_signature_verified=true`, `apple_device_chain_trusted=true`. Claims alone cannot prove device authenticity unless the provider truly verifies Apple's CMS chain.
- Provider download URL accepts one-time `challenge` and `return_to` URL parameters; do not log sensitive query strings. Avoid automated redirects to untrusted hosts.

## Pragmatic self-profile mode (device-reported, unverified)

An optional mode for the common get-UDID flow, implemented in `src/modules/enrollment/self-profile.ts` with endpoints `GET /api/enrollment/profile` and `POST /api/enrollment/profile-callback`. It exists because no external Profile Service provider is configured today; without it `/udid` can only show "unavailable".

**How it works**

1. `POST /api/enrollment/start` behaves exactly as before (same one-time challenge, 8-minute expiry, HttpOnly cookie, SQL rate limit). Provider mode still wins whenever it is configured; only when provider mode is absent and self-profile mode is fully configured does `start` return `mode: "self_profile"` and a `profileUrl` pointing at our own `/api/enrollment/profile?challenge=…`.
2. The profile endpoint serves a real Profile Service `.mobileconfig` (payload type `Profile Service`, callback URL on `APP_ORIGIN`, DeviceAttributes `UDID, PRODUCT, VERSION, SERIAL`, the session `Challenge`) only while that challenge row is still `pending` and unexpired.
3. After the person installs the profile, the device POSTs its attributes to `/api/enrollment/profile-callback`. The endpoint accepts a plain XML plist or a CMS/PKCS#7 envelope (DER or PEM). CMS input is opened with `openssl cms -verify -noverify` **only to extract the plist** — this mode does **not** verify the Apple device-identity certificate chain, and the code says so at the extraction site.
4. The atomic RPC `complete_guest_enrollment_self_report` matches the payload challenge against a still-pending, unexpired session exactly once (wrong challenge, expiry and replay all fail), stores the AES-GCM-sealed UDID and completes the session as status **`device_reported`** — a database constraint keeps this state distinct from `verified` (no `verified_at`, no provider reference, `report_source='self_profile'`). `GET /api/enrollment/status` then shows the UDID to the same browser with an explicit "UDID do máy của bạn gửi về, đang chờ xác minh" notice.
5. The UDID is also recorded on the owner's existing review path: `manual_udid_requests` with `source='self_profile'` and the usual `pending_unverified` status, via `submit_self_profile_udid_request` (same per-IP quota and duplicate guard as manual submissions; that write is best-effort and never fails the guest flow).
6. The device receives a `301` back to `/udid` on `APP_ORIGIN` (built from configuration, never from request data), so the person lands back on the page and sees their UDID.

**Trust level — the whole point of this mode**

The response body is self-asserted: anyone can craft an identical CMS blob offline, so a reported UDID is evidence of exactly the same strength as a hand-typed one. Consequently this mode **never** marks a device verified, **never** satisfies OTA eligibility (which requires the provider-attested verified path plus the verifier evidence in `docs/OTA_ELIGIBILITY.md`), and the UI never presents a reported UDID as verified. The owner still reviews pending requests and performs real Apple Developer registration separately.

**Enabling it**

- Apply migration `20261105120000_self_profile_enrollment.sql` to the Supabase project first (it is **not** yet applied to the real project).
- Set `ENROLLMENT_SELF_PROFILE_ENABLED=true` in addition to `ENROLLMENT_ENABLED=true`, `ENROLLMENT_WAF_READY=true` and the shared enrollment secrets listed above (provider URL/issuer/key are **not** required for this mode). Any missing piece makes every self-profile endpoint answer the standard 503.
- The callback's CMS extraction shells out to the `openssl` binary; the plain-XML path does not. Confirm `openssl` exists in the production runtime before relying on CMS-shaped responses.
- Optional signing: set both `ENROLLMENT_PROFILE_SIGN_CERT_PATH` and `ENROLLMENT_PROFILE_SIGN_KEY_PATH` to a PEM cert+key held in the secret manager (for example the domain's own Let's Encrypt certificate) and the profile is signed with `openssl smime`, so iOS shows it as signed by that certificate instead of the red "Not Signed" warning — provided the signing chain roots in a CA iOS already trusts. With neither variable set the profile is served unsigned and iOS shows the red unsigned warning; the flow still works. Setting only one of the two is treated as misconfiguration (mode stays off), and if signing is configured but fails at request time the download fails closed with `PROFILE_SIGNING_UNAVAILABLE` rather than silently downgrading. Never commit a certificate or key; the server holds paths only.

**Required real iPhone test for this mode — NOT DONE**

Synthetic unit tests cover the plist structure, XML and CMS extraction, challenge/UDID rejection and signing round-trip, but the following can only be proven on a physical iPhone and remain open: Safari actually downloads the profile from `/api/enrollment/profile`; how iOS labels the profile when unsigned vs signed with the configured certificate ("Not Signed" red warning vs signed state); the Settings → Profile Downloaded → Install flow completing; the device POSTing to the callback in the shape iOS really sends (plain plist vs CMS, headers, redirect handling of the 301 back to `/udid`); the status page updating for the same Safari session; behaviour on iOS 26+; expiry/replay attempts from a second device. Do not enable for customers before this test passes.

## Required real iPhone end-to-end test — NOT DONE

A physical iPhone and working CMS/SCEP provider are required. Test: Safari open page; consent; native profile download prompt; Settings → Profile Downloaded → Install; real Apple-signed CMS callback; one-time challenge; UI shows correct UDID; copy; duplicate callback rejected; expiry; wrong issuer/signature rejected; privacy deletion; device enrollment denial; iOS 26+ and different Safari sessions. Do not enable for users before testing.

**No claim of physical device validation is made.** This is integration-ready API foundation, not a completed Apple Profile Service deployment.

## Current operational limitation
No trusted Profile Service/SCEP provider endpoint or proof of iOS device compatibility has been configured, so provider mode remains unavailable and the verified API verifies a provider's **attestation**, not Apple's CMS itself; do not claim native CMS verification in the web app. The pragmatic self-profile mode above is implemented but **disabled by default** and equally unproven on a physical iPhone; with both modes off, the /udid UI deliberately shows an unavailable error rather than a fake downloadable profile.

The session table holds short-lived encrypted identifiers. A permanent, consensual device registration and admin-management workflow must be implemented separately, with retention/deletion and authenticated role checks. No persistent public UDID store is enabled yet.

## Privacy and retention
- The browser holding the short-lived enrollment cookie can invoke `DELETE /api/enrollment/status` to remove its own guest session; the route checks same-origin and removes the cookie.
- No long-lived UDID copy is automatically created for Admin. User consent for persistent registration and encrypted device records will be implemented separately.
- The current 8-minute expiration prevents web access to old UDIDs but does not itself delete expired rows. An operational purge job and deletion verification are still **required before production**.
