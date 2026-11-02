-- Quarantine scanner: receipts are NOT valid code signatures or OTA grants.
-- Service-only job claim/report. Admin may only acknowledge upload completion.
begin;
alter table public.ipa_upload_intakes
  drop constraint if exists ipa_upload_intakes_state_check;
alter table public.ipa_upload_intakes
  add constraint ipa_upload_intakes_state_check
  check (state in ('reserved','uploaded_pending_scan','scanning',
                  'quarantined_unverified','rejected','verified_internal'));

alter table public.ipa_upload_intakes
  add column scan_token uuid,
  add column scan_lease_until timestamptz,
  add column scan_attempts integer not null default 0 check(scan_attempts between 0 and 3),
  add column scan_finished_at timestamptz,
  add column scan_error text check(scan_error is null or scan_error ~ '^[A-Z0-9_]{3,60}$'),
  add column scan_report jsonb check(
    scan_report is null or
    (jsonb_typeof(scan_report)='object' and octet_length(scan_report::text)<=4096)
  );
create index ipa_intakes_scan_queue_idx
  on public.ipa_upload_intakes (state,created_at,scan_lease_until)
  where state in ('uploaded_pending_scan','scanning');

-- Only an authenticated, verified Admin may acknowledge their OWN receipt.
-- This client-side acknowledgement is not evidence that R2 contains the IPA.
create function private.ack_ipa_upload(p_receipt uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare
  actor uuid := (select auth.uid());
  changed integer;
begin
  if actor is null or not exists(
    select 1 from public.roles where user_id=actor and role='admin'
  ) or not exists(
    select 1 from auth.users where id=actor and email_confirmed_at is not null
     and (banned_until is null or banned_until<=now())
  ) then return false; end if;
  update public.ipa_upload_intakes as i
    set state='uploaded_pending_scan'
    where i.id=p_receipt and i.requested_by=actor
      and i.state='reserved' and i.expires_at>now();
  get diagnostics changed = row_count;
  return changed=1;
end
$$;
revoke all on function private.ack_ipa_upload(uuid) from public,anon;
grant execute on function private.ack_ipa_upload(uuid) to authenticated;
create function public.ack_ipa_upload(p_receipt uuid)
returns boolean language sql security invoker set search_path=''
as $$ select private.ack_ipa_upload(p_receipt); $$;
revoke all on function public.ack_ipa_upload(uuid) from public,anon;
grant execute on function public.ack_ipa_upload(uuid) to authenticated;

-- Claim one receipt, lock it atomically, lease for at most 15 minutes.
-- An expired claim can be retried (<=3 total) if a worker crashes.
-- Returned R2 object_key ALWAYS originates from the DB reservation RPC.
create function public.claim_ipa_scan()
returns table(id uuid,object_key text,expected_bytes bigint,
              scan_token uuid,scan_attempts integer)
language sql security invoker set search_path=''
as $$
  with picked as (
    select i.id from public.ipa_upload_intakes as i
    where i.expires_at>now() and i.scan_attempts<3 and (
      i.state='uploaded_pending_scan'
      or (i.state='scanning' and i.scan_lease_until<now())
    )
    order by i.created_at
    for update skip locked limit 1
  ), changed as (
    update public.ipa_upload_intakes as i
      set state='scanning', scan_token=gen_random_uuid(),
          scan_lease_until=now()+interval '15 minutes',
          scan_attempts=i.scan_attempts+1,scan_error=null
    from picked where i.id=picked.id
    returning i.id,i.object_key,i.expected_bytes,i.scan_token,i.scan_attempts
  ) select * from changed;
$$;
revoke all on function public.claim_ipa_scan() from public,anon,authenticated;
grant execute on function public.claim_ipa_scan() to service_role;

-- A stale worker cannot finalize a superseded lease.
-- Results are limited to rejection, retry, or QUARANTINE UNVERIFIED.
-- No function grants signing trust, publishing or OTA installation.
create function public.finish_ipa_scan(
 p_id uuid,p_token uuid,p_state text,p_sha256 text,
 p_report jsonb,p_error text
) returns boolean
language sql security invoker set search_path=''
as $$
  with changed as (
    update public.ipa_upload_intakes as i
    set state=p_state,
        sha256_verified=case when p_state='quarantined_unverified' then p_sha256 else null end,
        scan_report=case when p_state='quarantined_unverified' then p_report else null end,
        scan_error=p_error,
        scan_finished_at=case when p_state='uploaded_pending_scan' then null else now() end,
        scan_token=null,scan_lease_until=null,
        signature_trusted=false,install_eligible=false
    where i.id=p_id and i.scan_token=p_token and i.state='scanning'
      and i.scan_lease_until>now()
      and p_state in ('uploaded_pending_scan','quarantined_unverified','rejected')
      and (p_state<>'uploaded_pending_scan' or i.scan_attempts<3)
      and (p_error is null or p_error ~ '^[A-Z0-9_]{3,60}$')
      and (p_state<>'quarantined_unverified' or (
        p_sha256 ~ '^[0-9a-f]{64}$'
        and jsonb_typeof(p_report)='object'
        and octet_length(p_report::text)<=4096))
    returning i.id
  ) select exists(select 1 from changed);
$$;
revoke all on function public.finish_ipa_scan(uuid,uuid,text,text,jsonb,text)
 from public,anon,authenticated;
grant execute on function public.finish_ipa_scan(uuid,uuid,text,text,jsonb,text)
 to service_role;
commit;
