-- NOT YET APPLIED to the dedicated Supabase project `an-ipa-store`.
-- This file follows the repository migration convention (timestamped name,
-- begin/commit, RLS enabled, no browser-role access, service-role only) and
-- must be reconciled with the canonical project migration history
-- (platform_core, privacy_requests, harden_phase2_access, ...) and reviewed
-- before anyone applies it. It only ADDS new tables; it does not alter the
-- canonical devices / app_versions / distribution_channels / ipa_assets
-- tables, whose live columns are documented in docs/PHASE2_DATABASE.md.
--
-- install_grants: persistent server-issued OTA install grants. Only the
-- SHA-256 hash of the bearer token is stored. Grants are short-lived
-- (<= 10 minutes, matching the domain manifest grant cap) and reusable
-- inside their window because iOS fetches the manifest and the IPA more
-- than once; they are never single-use. Revocation is a status flip.
-- verifier_attestations: output records of a trusted verifier (macOS
-- worker). One row per verification run of one artifact; the newest row
-- whose artifact_sha256 matches the asset is the evidence source.
begin;
create table public.install_grants (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  device_id uuid not null,
  version_id uuid not null,
  channel_id uuid null,
  artifact_sha256 text not null check(artifact_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'active' check(status in ('active','revoked')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null
    check(expires_at > issued_at and expires_at <= issued_at + interval '10 minutes'),
  first_used_at timestamptz null,
  last_used_at timestamptz null,
  use_count integer not null default 0 check(use_count >= 0),
  revoked_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default now()
);
create index install_grants_device_version_idx
  on public.install_grants(device_id, version_id, issued_at desc);
create index install_grants_expires_idx on public.install_grants(expires_at);
alter table public.install_grants enable row level security;
revoke all on public.install_grants from public, anon, authenticated;
grant select, insert, update on public.install_grants to service_role;

create table public.verifier_attestations (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  artifact_sha256 text not null check(artifact_sha256 ~ '^[a-f0-9]{64}$'),
  verifier_id text not null check(length(verifier_id) between 1 and 120),
  signature_verified boolean not null,
  nested_signatures_present boolean not null,
  nested_team_matches boolean not null,
  dylib_dependencies_resolved boolean not null,
  artifact_team_id text null check(artifact_team_id is null or length(artifact_team_id) <= 64),
  entitlements_match boolean not null,
  signing_certificate_expires_at timestamptz null,
  signing_certificate_revoked boolean not null default false,
  verified_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index verifier_attestations_asset_idx
  on public.verifier_attestations(asset_id, verified_at desc);
alter table public.verifier_attestations enable row level security;
revoke all on public.verifier_attestations from public, anon, authenticated;
grant select, insert on public.verifier_attestations to service_role;
commit;
