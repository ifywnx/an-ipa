# AN IPA STORE — Database reality (2026-11-03)

The actual Supabase project `an-ipa-store` contains 15 public tables and had migrations
`20261102193636_platform_core` and `20261102194318_privacy_requests` before this work.

**Do not run** the earlier proposed `20261103000100_phase2_core.sql`: its table
names overlap and its columns differ. It has been neutralized into a no-op in the repository.

## Applied hardening
The Supabase migration `harden_phase2_access` has been successfully applied.
Its source is `supabase/migrations/20261103000200_harden_phase2_access.sql`.
- Anonymous/authenticated catalog reads are limited to selected columns for published apps via RLS.
- Client INSERT/UPDATE/DELETE permissions on apps, versions, distribution channels, devices and IPA asset metadata are revoked.
- Publisher-wide mutations (which previously could affect other publishers), direct IPA upload access and device registration are disabled pending security review.
- Other sensitive tables retain RLS fail-closed. Informational advisor findings `rls_enabled_no_policy` are expected for intentionally inaccessible tables.
- No device has been enrolled, no IPA has been signed and no admin access has been activated.

## Required next
Test anonymous catalog using the active publishable key against a published synthetic record in a disposable test project. Add cross-user RLS integration tests and backend auth before reenabling writes. Store UDID encrypted with keyed lookup HMAC, prove deletion/retention, and validate IPA signing using a macOS worker. Never use service-role credentials in frontend.
