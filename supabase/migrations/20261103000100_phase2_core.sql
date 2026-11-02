-- AN IPA STORE / Phase 2 baseline. Apply only to a dedicated, reviewed Supabase project.
-- No sample identities, credentials or production data. All sensitive writes happen in a future trusted backend.
begin;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','publisher','admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
create table public.apps (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  title text not null check (char_length(title) between 1 and 140),
  summary text not null default '' check (char_length(summary) <= 1000),
  category text not null check (char_length(category) between 1 and 80),
  developer_name text not null check (char_length(developer_name) between 1 and 120),
  publisher_id uuid not null references auth.users(id),
  status text not null default 'draft' check (status in ('draft','review','published','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index apps_publisher_id_idx on public.apps(publisher_id);
create index apps_public_catalog_idx on public.apps(created_at desc) where status='published';
create table public.app_versions (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  version text not null check (char_length(version) between 1 and 80),
  build text not null check (char_length(build) between 1 and 80),
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected','revoked')),
  created_at timestamptz not null default now(),
  unique(app_id, build)
);
create index app_versions_app_id_idx on public.app_versions(app_id);
create table public.ipa_assets (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.app_versions(id) on delete cascade,
  storage_key text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  quarantine_status text not null default 'pending' check (quarantine_status in ('pending','verified','rejected')),
  created_at timestamptz not null default now()
);
create index ipa_assets_version_id_idx on public.ipa_assets(version_id);
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  udid_ciphertext text not null,
  udid_lookup_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','approved','rejected','revoked')),
  apple_registration_status text not null default 'unverified' check (apple_registration_status in ('unverified','pending','registered','rejected','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index devices_owner_id_idx on public.devices(owner_id);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 120),
  target_type text not null,
  target_id uuid,
  details_redacted jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_actor_id_idx on public.audit_logs(actor_id);
create index audit_logs_created_at_idx on public.audit_logs(created_at desc);

-- All tables default to deny for client queries. Only explicitly public, published
-- catalog records are exposed anonymously.
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.apps enable row level security;
alter table public.app_versions enable row level security;
alter table public.ipa_assets enable row level security;
alter table public.devices enable row level security;
alter table public.audit_logs enable row level security;

-- Explicitly remove broad default grants. A trusted backend must implement
-- authorization/audit before enabling any mutation. Never use service key in browser.
revoke all on public.profiles from anon, authenticated;
revoke all on public.roles from anon, authenticated;
revoke all on public.app_versions from anon, authenticated;
revoke all on public.ipa_assets from anon, authenticated;
revoke all on public.devices from anon, authenticated;
revoke all on public.audit_logs from anon, authenticated;
revoke all on public.apps from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select (slug,title,summary,category,developer_name,status,created_at)
  on public.apps to anon, authenticated;
create policy published_catalog_read on public.apps
  for select to anon, authenticated using (status = 'published');
-- No client insert/update/delete policies are installed.

commit;
