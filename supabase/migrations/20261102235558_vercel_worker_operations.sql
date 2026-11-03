begin;
alter table public.ipa_upload_intakes
 add column next_scan_at timestamptz not null default now(),
 add column delete_after timestamptz not null default (now()+interval '7 days'),
 add column object_deleted_at timestamptz,
 add column cleanup_token uuid,
 add column cleanup_lease_until timestamptz,
 add column cleanup_attempts integer not null default 0 check(cleanup_attempts between 0 and 10),
 add column cleanup_error text check(cleanup_error is null or cleanup_error ~ '^[A-Z0-9_]{3,60}$');
create index ipa_cleanup_due on public.ipa_upload_intakes(delete_after) where object_deleted_at is null;
create table public.ipa_worker_runs (
 id uuid primary key default gen_random_uuid(), intake_id uuid references public.ipa_upload_intakes(id) on delete set null,
 kind text not null check(kind in ('scan','cleanup','self_test')),
 status text not null check(status in ('running','succeeded','failed','idle')),
 error_code text check(error_code is null or error_code ~ '^[A-Z0-9_]{3,60}$'),
 started_at timestamptz not null default now(), finished_at timestamptz
);
create index ipa_worker_runs_started on public.ipa_worker_runs(started_at desc);
create index ipa_worker_runs_intake on public.ipa_worker_runs(intake_id);
alter table public.ipa_worker_runs enable row level security;
revoke all on public.ipa_worker_runs from public,anon,authenticated;
grant select on public.ipa_worker_runs to authenticated;
grant select,insert,update,delete on public.ipa_worker_runs to service_role;
create policy admin_worker_health on public.ipa_worker_runs for select to authenticated using((select private.has_role(array['admin'])));

-- The targeted RPC makes workflow replay safe: it never claims another receipt.
create function public.claim_ipa_scan_receipt(p_id uuid)
returns table(id uuid,object_key text,expected_bytes bigint,scan_token uuid,scan_attempts integer)
language sql security invoker set search_path='' as $$
 with picked as (
  select i.id from public.ipa_upload_intakes i
  where i.id=p_id and i.expires_at>now() and i.object_deleted_at is null
   and i.scan_attempts<3 and i.next_scan_at<=now()
   and (i.state='uploaded_pending_scan' or (i.state='scanning' and i.scan_lease_until<now()))
  for update skip locked limit 1
 ), changed as (
  update public.ipa_upload_intakes i set state='scanning',scan_token=gen_random_uuid(),
   scan_lease_until=now()+interval '15 minutes',scan_attempts=i.scan_attempts+1,scan_error=null
  from picked where i.id=picked.id returning i.id,i.object_key,i.expected_bytes,i.scan_token,i.scan_attempts
 ) select * from changed;
$$;
revoke all on function public.claim_ipa_scan_receipt(uuid) from public,anon,authenticated;
grant execute on function public.claim_ipa_scan_receipt(uuid) to service_role;

-- Enforce backoff / reject retention even for the standalone worker.
create function private.ipa_scan_retention() returns trigger language plpgsql set search_path='' as $$
begin
 if new.state='uploaded_pending_scan' and old.state='scanning' then
  new.next_scan_at=now()+make_interval(secs=>least(600,30*power(2,new.scan_attempts)::integer));
 end if;
 if new.state='rejected' and old.state<>'rejected' then
  new.delete_after=least(new.delete_after,now()+interval '1 day');
 end if;
 return new;
end $$;
revoke all on function private.ipa_scan_retention() from public,anon,authenticated;
create trigger ipa_scan_retention before update on public.ipa_upload_intakes for each row execute function private.ipa_scan_retention();
-- Preserve the existing no-arg worker contract, now honoring retry delay.
create or replace function public.claim_ipa_scan()
returns table(id uuid,object_key text,expected_bytes bigint,scan_token uuid,scan_attempts integer)
language sql security invoker set search_path='' as $$
 with picked as (
  select i.id from public.ipa_upload_intakes i
  where i.expires_at>now() and i.object_deleted_at is null and i.scan_attempts<3 and i.next_scan_at<=now()
   and (i.state='uploaded_pending_scan' or (i.state='scanning' and i.scan_lease_until<now()))
  order by i.created_at for update skip locked limit 1
 ), changed as (
  update public.ipa_upload_intakes i set state='scanning',scan_token=gen_random_uuid(),
   scan_lease_until=now()+interval '15 minutes',scan_attempts=i.scan_attempts+1,scan_error=null
  from picked where i.id=picked.id returning i.id,i.object_key,i.expected_bytes,i.scan_token,i.scan_attempts
 ) select * from changed;
$$;
revoke all on function public.claim_ipa_scan() from public,anon,authenticated;
grant execute on function public.claim_ipa_scan() to service_role;

create function public.claim_ipa_cleanup(p_id uuid)
returns table(id uuid,object_key text,cleanup_token uuid)
language sql security invoker set search_path='' as $$
 with picked as (
  select i.id from public.ipa_upload_intakes i where i.id=p_id
   and i.object_deleted_at is null and i.delete_after<=now()
   and i.state in ('rejected','quarantined_unverified')
   and i.cleanup_attempts<10 and (i.cleanup_lease_until is null or i.cleanup_lease_until<now())
  for update skip locked limit 1
 ), changed as (
  update public.ipa_upload_intakes i set cleanup_token=gen_random_uuid(),
   cleanup_lease_until=now()+interval '5 minutes',cleanup_attempts=i.cleanup_attempts+1
  from picked where i.id=picked.id returning i.id,i.object_key,i.cleanup_token
 ) select * from changed;
$$;
create function public.finish_ipa_cleanup(p_id uuid,p_token uuid,p_deleted boolean,p_error text default null)
returns boolean language sql security invoker set search_path='' as $$
 with changed as (
  update public.ipa_upload_intakes i set object_deleted_at=case when p_deleted then now() else null end,
    cleanup_error=case when p_deleted then null else p_error end,
    cleanup_token=null,cleanup_lease_until=null
  where i.id=p_id and i.cleanup_token=p_token and i.cleanup_lease_until>now()
    and i.object_deleted_at is null and i.state in ('rejected','quarantined_unverified')
    and (p_deleted or p_error ~ '^[A-Z0-9_]{3,60}$') returning i.id
 ) select exists(select 1 from changed);
$$;
revoke all on function public.claim_ipa_cleanup(uuid) from public,anon,authenticated;
revoke all on function public.finish_ipa_cleanup(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_ipa_cleanup(uuid) to service_role;
grant execute on function public.finish_ipa_cleanup(uuid,uuid,boolean,text) to service_role;
commit;
