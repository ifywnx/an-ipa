# Phase 3 — private IPA upload from Safari iPhone

## Implemented in repository

- Mobile Admin chooses an IPA exported from LCSign on the owner's iPhone; local preflight checks ZIP magic, extension and size.
- `POST /api/admin/uploads/prepare` checks encrypted Admin session, Supabase Auth identity, **fresh Admin DB role**, exact Origin, bounded JSON request and fixed 100 MiB pilot size. It returns a short-lived presigned S3-compatible `PUT` URL only if all four private-upload readiness flags are true.
- Presigned R2 URL is generated server-side with Signature V4; bucket is path-scoped to a random `quarantine/<UUID>.ipa`. Content-Type and **Content-Length** are signed; the browser sends its Content-Length automatically. URL expires after five minutes. Credential strings never enter frontend.
- Browser uses `XMLHttpRequest` to stream file from iPhone, show progress and allow cancel. A 2xx PUT means only *quarantine storage received bytes*, not IPA verified, approved or installed.
- This pilot uses one PUT for up to 100 MiB, **not** resumable. Cloudflare recommends multipart for large files, especially for iPhone/mobile networks.

## Blocking setup — upload stays OFF

1. Dedicated **private** R2 bucket, never expose r2.dev or a public custom domain for quarantine.
2. Restrict R2 credentials to required bucket and minimal object operations; store Access Key ID + Secret Access Key only in hosting secrets. Configure bucket CORS for the exact website origin, PUT and Content-Type.
3. Configure lifecycle expiry for abandoned `quarantine/` objects and server-side upload quota/throttling and audit. The current code requires trusted WAF controls.
4. Deploy a real isolated scanning/verification worker, object size/hash checks, untrusted ZIP prevention, certificate/profile code-signing verifier and immutable status registry. This repo currently has **offline inspector code only**, not an automatically processing worker.
5. Perform real signed Content-Length PUT tests on actual Cloudflare R2 with Safari iPhone. Not tested. Adjust header signing if R2/browser cannot prove exact-size enforcement.
6. Only after the above, set `R2_PRIVATE_UPLOAD_ENABLED=true`, `R2_PRIVATE_WAF_READY=true`, `R2_QUARANTINE_LIFECYCLE_READY=true`, `R2_SCANNER_READY=true`. Never enable simply to demonstrate a button.
7. Expand to multipart/resumable for IPA over 100 MiB before calling the upload experience complete.

## Security limitations

- Presigned URLs are bearer capabilities; anyone holding one may PUT to the scoped object until expiry, and it might be used more than once until expired. No client is trusted to assert artifact verification.
- The upload endpoint has no persistent intake quotas/records yet; enabling without a trusted WAF and quota system would be unsafe.
- The separately implemented offline worker has not been wired to R2 lifecycle, nor does it cryptographically verify Apple code signatures. No OTA grant is exposed.
- LCSign runs only on owner's iPhone; no P12/private key is collected or stored by AN IPA STORE.

References:
- https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- https://developers.cloudflare.com/r2/objects/upload-objects/
- https://developers.cloudflare.com/r2/buckets/cors/


## Operator setup (Vietnamese)

See [Tạo Cloudflare R2 riêng tư](R2_CLOUDFLARE_SETUP_VI.md) for Cloudflare Dashboard setup, exact Preview CORS origin, private API token scope, and safety gates.

## Admin-only R2 connectivity diagnostics

A read-only `GET /api/admin/storage/health` route is available only to authenticated Admin on Vercel Preview when `R2_STORAGE_DIAGNOSTICS_ENABLED=true` (Preview branch-scoped). It sends a signed 60-second **HEAD Bucket** directly from server to R2; only fixed status messages reach the browser, no access keys or presigned URLs. No IPA object is created. Cloudflare R2 supports HeadBucket.

This status cannot confirm bucket CORS, object upload permissions, isolated scanner or Apple signing; upload flags remain OFF. Do not enable diagnostic in production.

## Private R2 write test (Preview only)

The Admin page has a separate **write / HEAD / delete synthetic sample** button. The server-only `POST /api/admin/storage/write-test` is behind exact same-origin, a freshly verified Admin session, Vercel Preview and a separate `R2_WRITE_DIAGNOSTICS_ENABLED` flag. The test writes at most 256 bytes of synthetic text to a **random UUID path** under `diagnostics/`, verifies `HEAD Object` content length, and then tries `DELETE Object` even when the write response failed. `If-None-Match: *` prevents overwriting an existing object.

The browser only sees fixed status codes; it never receives R2 credentials, URLs, object names or payload. If deletion fails, the endpoint fails closed and the operator must inspect `diagnostics/` for leftovers; configure lifecycle expiry for diagnostics as defense in depth.

A successful test checks server-side Object Read/Write/Delete only. It **does not validate CORS, Safari uploads, Ad Hoc profile, code signature, IPA authenticity or OTA eligibility**. The R2 IPA upload feature flags remain OFF. Disable `R2_WRITE_DIAGNOSTICS_ENABLED` after testing.

## Verification improvement — 2026-11-03

The first live user test showed a successful PUT and DELETE but the HEAD Object size check was inconclusive. The exact R2 HEAD response/status was not recorded, so the root cause is not yet confirmed. The diagnostic now performs **PUT → HEAD (informational) → GET (bounded to 256 bytes, exact byte comparison) → DELETE**. A successful GET comparison and confirmed DELETE returns a separate success when HEAD metadata could not be validated; do not mistake that for proof HEAD worked. If GET is blocked or bytes differ, the route returns a specific fixed error. This is synthetic server-side R2 testing only; Safari CORS, IPA uploads, Apple code signing and OTA remain unverified.
