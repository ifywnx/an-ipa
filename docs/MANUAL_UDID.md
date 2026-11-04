# AN IPA STORE — manual UDID intake

Source: `/udid/manual`, `/api/devices/manual`, migration `guest_manual_udid_pending_requests` applied to dedicated Supabase project.

Guests can submit a UDID **only** with explicit consent and with two feature gates `MANUAL_UDID_ENABLED=true`, `MANUAL_UDID_WAF_READY=true` after a trusted reverse proxy sanitizes `ENROLLMENT_TRUSTED_IP_HEADER`. Production defaults to 503, no collection. The browser and server share the same two-format UDID syntax validator (40 hex, or 8 hex + `-` + 16 hex); browser validation is only a convenience and the API repeats it server-side.

Data model: AES-256-GCM ciphertext + keyed HMAC UDID lookup + four-character suffix; no plaintext UDID in browser status, logs or public database. HttpOnly Secure SameSite cookie with random 256-bit token authorizes guest status/deletion. Database blocks more than 3 submissions per source-IP HMAC per hour and recent duplicate pending UDIDs. RLS enabled and no anon/authenticated grants.

**Security warning:** All manual requests remain `pending_unverified`; no OTA allowed. Admin review and legitimate Apple Developer provisioning are separate workflows. A 30-day expiry field does not itself delete rows. Deploy a scheduled purge and verify privacy deletion/retention and Admin RBAC before enabling. Do not claim any iPhone test occurred.
