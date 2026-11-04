# Secure retention for guest device data

## Live database
The dedicated Supabase project has migration `purge_expired_device_intake`, which defines a `SECURITY INVOKER` RPC with no `anon` or `authenticated` execute rights. It deletes *expired* entries from `guest_enrollments` and `manual_udid_requests` and returns only aggregate counts. It cannot read individual UDIDs or create installation eligibility.

## Protected maintenance endpoint
`POST /api/internal/retention` is disabled by default. Requires all of:
- `MAINTENANCE_ENABLED=true`
- server-only `SUPABASE_SECRET_KEY` and HTTPS `NEXT_PUBLIC_SUPABASE_URL`
- secret `MAINTENANCE_CRON_SECRET` (at least 40 characters) in hosting secret manager, supplied as an exact Bearer token over HTTPS.

It uses constant-time comparison and calls the server-side RPC. No secret should be committed to GitHub. Never schedule the endpoint before security reviews, private hosting configuration and monitored alerts.

The current site has **no configured scheduler**. To ensure real deletion, provision a secure scheduled POST (for example once per day) from a trusted scheduler, verify HTTP 200 and audit aggregated counts. This endpoint does not delete Auth accounts or previously exported data.

## Tests before enabling
- Test user-requested deletion and due-date purge on isolated synthetic data; ensure manual requests and sessions are removed.
- Confirm database grants deny execution to `anon` and `authenticated`.
- Check expired sessions are not returned via frontend status, and ensure backups and logs have documented retention.
- Observe endpoint abuse, failed authentication and secret rotation.

No IPA signing keys or UDIDs are stored in this document.
