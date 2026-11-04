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
- All server APIs return 503 unless **all** enrollment settings are explicitly configured and trusted WAF/edge is ready. Profile download must be served by a separate, real Apple-compliant enrollment provider; we **never synthesize a fake profile**.

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

## Required real iPhone end-to-end test — NOT DONE

A physical iPhone and working CMS/SCEP provider are required. Test: Safari open page; consent; native profile download prompt; Settings → Profile Downloaded → Install; real Apple-signed CMS callback; one-time challenge; UI shows correct UDID; copy; duplicate callback rejected; expiry; wrong issuer/signature rejected; privacy deletion; device enrollment denial; iOS 26+ and different Safari sessions. Do not enable for users before testing.

**No claim of physical device validation is made.** This is integration-ready API foundation, not a completed Apple Profile Service deployment.

## Current operational limitation
No trusted Profile Service/SCEP provider endpoint or proof of iOS device compatibility has been configured. The /udid UI deliberately shows an unavailable error rather than a fake downloadable profile. The current API verifies a provider's **attestation**, not Apple's CMS itself; do not claim native CMS verification in the web app.

The session table holds short-lived encrypted identifiers. A permanent, consensual device registration and admin-management workflow must be implemented separately, with retention/deletion and authenticated role checks. No persistent public UDID store is enabled yet.

## Privacy and retention
- The browser holding the short-lived enrollment cookie can invoke `DELETE /api/enrollment/status` to remove its own guest session; the route checks same-origin and removes the cookie.
- No long-lived UDID copy is automatically created for Admin. User consent for persistent registration and encrypted device records will be implemented separately.
- The current 8-minute expiration prevents web access to old UDIDs but does not itself delete expired rows. An operational purge job and deletion verification are still **required before production**.
