# Phase 2 — Database baseline

The migration `supabase/migrations/20261103000100_phase2_core.sql` is source code, **not applied** to any Supabase project. Do not choose an existing unrelated project. Review and run against an isolated local Supabase stack first.

## Security model

- Catalog: anonymous clients read only public metadata columns for `status='published'`. No read access to `publisher_id` or internal UUID via the public projection.
- Profiles, roles, versions, IPA assets, devices and audit logs: RLS enabled, no anonymous/authenticated table grants, and no client policies.
- All writes remain disabled to browser clients. A future authenticated backend must validate actor identity, check roles from trusted database records, audit mutations and manage request limits.
- Never persist raw UDID, encryption keys, IPA bytes or Apple signing credentials in migration files, logs or version control.
- `udid_ciphertext` needs an application-level envelope encryption/key-rotation design; `udid_lookup_hash` requires a keyed HMAC in backend. Neither is implemented.
- The catalog is deliberately read-only. SQL alone does not demonstrate an end-to-end secure system.

## Validation required before applying

1. Use a dedicated test database and record migration hash.
2. Run SQL migrations in a transaction and test schema, constraints and RLS with anon, authenticated and service-role identities.
3. Attempt cross-user reads and writes, role escalation and unauthorized access to devices, assets and audit logs.
4. Verify that a non-published app is invisible and published metadata is readable; verify sensitive columns cannot be read.
5. Integrate Supabase Auth only after redirect origins, email provider, CSRF/session handling and privacy policy have been reviewed.

## Out of scope

No connection to a live Supabase project has been made. IPA upload, signing, enrollment and production deployment are blocked pending later phases.
