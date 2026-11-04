# Supabase integration audit (2026-11-03)

## Confirmed project
- Dedicated project: `an-ipa-store` (Singapore), already active.
- Canonical migration history: `20261102193636_platform_core`, `20261102194318_privacy_requests`, and **`harden_phase2_access` applied 2026-11-03**.
- 15 public tables already existed; all RLS enabled. Previous repository draft migration conflicted and is now a no-op.
- Public catalog maps columns `slug,name,developer,description,category,published`; it never queries sensitive rights reference metadata.
- No users or published records at inspection; no real IPA or Apple signing integration.

## Safety checks
- Migration removed mutations on app catalog, app versions, distribution channels, IPA assets and device registration by browser roles.
- Limited selected catalog columns to anonymous/authenticated, subject to `published` RLS.
- Removed permissive publisher-wide policies and storage IPA upload/read policies.
- Confirmed security advisor only reported informational no-policy warnings for deliberately blocked tables.
- Never commit keys. Put `NEXT_PUBLIC_SUPABASE_URL` and the *publishable* key in protected hosting environment only.

## Work remaining
- Proper Supabase Auth SSR with `@supabase/ssr`, verified claims and cookie refresh.
- Distinct-user database tests proving RLS, server-side role decisions, invitation/onboarding and secure provider configuration.
- Actual UI integration, tests on mobile, privacy-aware encrypted UDID lifecycle and macOS signing worker.
- No production release until full security gate.
