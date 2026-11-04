-- Applied in Supabase migration history as:
-- 20261102231052 admin_ipa_intake_registry_quota
-- 20261102231143 fix_admin_ipa_intake_quota_column_alias
-- The function below is the corrected, reproducible definition.
begin;
create table public.ipa_upload_intakes (
 id uuid primary key default gen_random_uuid(),
 requested_by uuid not null references auth.users(id) on delete restrict,
 filename text not null,
 expected_bytes bigint not null check(expected_bytes between 100 and 104857600),
 object_key text not null unique,
 state text not null default 'reserved'
   check(state in ('reserved','quarantined_unverified','rejected','verified_internal')),
 signature_trusted boolean not null default false check(signature_trusted = false),
 install_eligible boolean not null default false check(install_eligible = false),
 sha256_verified text null check(sha256_verified is null or sha256_verified ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null
);
create index ipa_upload_intakes_actor_created_idx on public.ipa_upload_intakes(requested_by,created_at desc);
create index ipa_upload_intakes_expiry_idx on public.ipa_upload_intakes(expires_at);
alter table public.ipa_upload_intakes enable row level security;
revoke all on public.ipa_upload_intakes from public,anon,authenticated;
grant select on public.ipa_upload_intakes to authenticated;
grant select,insert,update,delete on public.ipa_upload_intakes to service_role;
create policy ipa_upload_intakes_admin_read on public.ipa_upload_intakes
 for select to authenticated
 using(requested_by=(select auth.uid()) and (select private.has_role(array['admin'::text])));

create function private.reserve_ipa_intake(p_filename text,p_expected_bytes bigint)
returns table(id uuid,object_key text,expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
 actor uuid := (select auth.uid());
 next_id uuid := gen_random_uuid();
 active_count integer;
 hourly_count integer;
 daily_bytes bigint;
begin
 if actor is null or not exists(
   select 1 from public.roles where user_id=actor and role='admin'
 ) or not exists(
   select 1 from auth.users
   where auth.users.id=actor and email_confirmed_at is not null
    and (banned_until is null or banned_until<=now())
 ) then
   raise exception 'ACCESS_DENIED' using errcode='42501';
 end if;
 if p_filename is null or length(p_filename)<5 or length(p_filename)>180
   or p_filename !~* '\.ipa$'
   or position('/' in p_filename)>0
   or position(chr(92) in p_filename)>0
   or p_filename ~ '[[:cntrl:]]'
   or p_expected_bytes is null
   or p_expected_bytes<100 or p_expected_bytes>104857600 then
   raise exception 'INVALID_IPA_INTAKE' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('an-ipa-intake-' || actor::text,7));
 select count(*) filter(where i.created_at>=now()-interval '1 hour'),
        count(*) filter(where i.state='reserved' and i.expires_at>now()),
        coalesce(sum(i.expected_bytes) filter(where i.created_at>=now()-interval '24 hours'),0)
 into hourly_count,active_count,daily_bytes
 from public.ipa_upload_intakes as i where i.requested_by=actor;
 if hourly_count>=5 or active_count>=3 or daily_bytes+p_expected_bytes>524288000 then
   raise exception 'IPA_INTAKE_QUOTA' using errcode='P0001';
 end if;
 return query
 insert into public.ipa_upload_intakes as newi
  (id,requested_by,filename,expected_bytes,object_key,expires_at)
 values
  (next_id,actor,p_filename,p_expected_bytes,
   'quarantine/' || next_id::text || '.ipa',now()+interval '1 hour')
 returning newi.id,newi.object_key,newi.expires_at;
end
$$;
revoke all on function private.reserve_ipa_intake(text,bigint) from public,anon;
grant execute on function private.reserve_ipa_intake(text,bigint) to authenticated;
create function public.reserve_ipa_intake(p_filename text,p_expected_bytes bigint)
returns table(id uuid,object_key text,expires_at timestamptz)
language sql security invoker set search_path = ''
as $$
 select * from private.reserve_ipa_intake(p_filename,p_expected_bytes);
$$;
revoke all on function public.reserve_ipa_intake(text,bigint) from public,anon;
grant execute on function public.reserve_ipa_intake(text,bigint) to authenticated;
commit;
