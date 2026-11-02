# Supabase integration audit (2026-11-03)

## Confirmed project
- Supabase project name: `an-ipa-store`, region `ap-southeast-1`. Project ref is not a secret.
- Existing migration history: `20261102193636_platform_core` and `20261102194318_privacy_requests`.
- Live public schema has 15 tables, all with RLS enabled at inspection.
- These tables predate the Phase 2 GitHub migration file and have a **different schema**. Never run the obsolete proposed migration onto this project.
- No users, published apps or device records existed at inspection. No IPA signing or Apple integration exists.
- Public catalog is mapped to `apps(slug,name,developer,description,category,published)`.
- Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in hosting platform environment, not as a committed actual `.env.local`. Publishable keys are client safe but service/secret keys are not.
- Auth and admin mutations must remain disabled until secure session, server-side roles, rate limits and redirect settings have passed security tests.

## Data exposure and Phase 2 hardening
Security review found authenticated publisher policies allowing edits across other publishers' apps and an overly broad anonymous table SELECT grant. A hardening migration restricts these; upload/device writes are withheld pending encryption and validation. See `docs/PHASE2_DATABASE.md`.

## Before real Auth
Use `@supabase/ssr` with Next.js Proxy refresh and verified `getClaims()` (not client-supplied metadata) per official guidance. Do not implement homemade JWT parsing. Require verified email and server-side role checks and provider-specific anti-abuse. Review callback domains, SMTP and safe account recovery before opening sign-in.

## Verification still required
Local RLS integration tests with distinct authenticated identities; Apple device verification, signing worker, IPA upload pipeline, encryption/retention of UDID, dependency security audit and staging tests.
