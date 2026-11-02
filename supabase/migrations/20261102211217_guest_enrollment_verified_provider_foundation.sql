-- Applied to dedicated AN IPA STORE Supabase project on 2026-11-03.
-- Anonymous browsers never access this table: server secret and verified provider only.
begin;
create table public.guest_enrollments (
  id uuid primary key default gen_random_uuid(),
  browser_token_hash text not null unique check (browser_token_hash ~ '^[a-f0-9]{64}$'),
  challenge_hash text not null unique check (challenge_hash ~ '^[a-f0-9]{64}$'),
  ip_lookup_hmac text not null check (ip_lookup_hmac ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  udid_ciphertext text,
  udid_lookup_hmac text check (udid_lookup_hmac is null or udid_lookup_hmac ~ '^[a-f0-9]{64}$'),
  provider_reference text,
  consent_version text not null,
  consent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint verified_requires_proof check (
    (status = 'verified' and udid_ciphertext is not null and udid_lookup_hmac is not null and verified_at is not null)
    or (status <> 'verified' and udid_ciphertext is null and udid_lookup_hmac is null and verified_at is null)
  )
);
create index guest_enrollments_ip_created on public.guest_enrollments(ip_lookup_hmac,created_at desc);
create index guest_enrollments_expiry on public.guest_enrollments(expires_at);
alter table public.guest_enrollments enable row level security;
revoke all on public.guest_enrollments from public, anon, authenticated;

create function public.create_guest_enrollment(
  p_browser_hash text, p_challenge_hash text, p_ip_hmac text,
  p_expires_at timestamptz
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare new_id uuid;
begin
  if p_browser_hash !~ '^[a-f0-9]{64}$' or p_challenge_hash !~ '^[a-f0-9]{64}$' or p_ip_hmac !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid enrollment digest';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '10 minutes' then
    raise exception 'invalid expiry';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_ip_hmac, 0));
  if (select count(*) from public.guest_enrollments
      where ip_lookup_hmac=p_ip_hmac and created_at > now()-interval '1 hour') >= 3 then
    raise exception 'enrollment rate limited';
  end if;
  insert into public.guest_enrollments(
    browser_token_hash,challenge_hash,ip_lookup_hmac,expires_at,consent_version
  ) values (p_browser_hash,p_challenge_hash,p_ip_hmac,p_expires_at,'2026-11-03')
  returning id into new_id;
  return new_id;
end $$;

create function public.complete_guest_enrollment(
  p_challenge_hash text, p_udid_ciphertext text, p_udid_hmac text,
  p_provider_reference text
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare updated_id uuid;
begin
  if p_challenge_hash !~ '^[a-f0-9]{64}$' or p_udid_hmac !~ '^[a-f0-9]{64}$'
    or length(p_udid_ciphertext) < 40 or length(p_udid_ciphertext) > 512
    or length(p_provider_reference) > 120 then
    return false;
  end if;
  update public.guest_enrollments
  set status='verified', udid_ciphertext=p_udid_ciphertext,
      udid_lookup_hmac=p_udid_hmac, verified_at=now(), provider_reference=p_provider_reference
  where challenge_hash=p_challenge_hash and status='pending' and expires_at>now()
  returning id into updated_id;
  return updated_id is not null;
end $$;

revoke all on function public.create_guest_enrollment(text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.complete_guest_enrollment(text,text,text,text) from public, anon, authenticated;
grant execute on function public.create_guest_enrollment(text,text,text,timestamptz) to service_role;
grant execute on function public.complete_guest_enrollment(text,text,text,text) to service_role;
commit;
