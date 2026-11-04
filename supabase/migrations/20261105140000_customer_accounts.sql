-- Customer accounts: link UDID intake records to Supabase Auth users.
-- NOT YET APPLIED to the dedicated Supabase project `an-ipa-store`: it must
-- be reconciled with the canonical project migration history (platform_core,
-- privacy_requests, harden_phase2_access, ...) and reviewed before anyone
-- applies it. CUSTOMER_ACCOUNTS_ENABLED must stay false until this
-- migration is applied AND Supabase Auth is configured per
-- docs/CUSTOMER_ACCOUNTS.md.
--
-- Design notes:
-- * The owner link goes on the two intake tables defined in this
--   repository: manual_udid_requests (the customer-visible device/UDID
--   request record; BOTH intake paths land there — manual form and
--   self-profile, distinguished by `source`) and guest_enrollments (the
--   short-lived browser session, so the device callback can inherit the
--   owner recorded when the session started). The canonical `devices`
--   table belongs to platform_core outside this repository and is NOT
--   altered here; when an operator promotes a request into a device
--   record, the owner carries over from the request row.
-- * Access model follows the repository convention: browser roles get no
--   direct table access; all customer reads/writes go through server
--   routes that verify the Supabase session server-side and then use the
--   service role scoped by the VERIFIED user id. As defence in depth,
--   authenticated users additionally receive a column-limited SELECT grant
--   plus a read-own-rows RLS policy on manual_udid_requests (the same
--   pattern harden_phase2_access used for the apps catalog): the granted
--   columns exclude udid_ciphertext, udid_hmac and request_token_hash.
-- * Ownership is bookkeeping only. Nothing here changes a record's status,
--   marks a device verified, or feeds OTA eligibility.
-- * Claiming is possession-based: every claim RPC requires the SHA-256
--   hash of the browser credential that created the record (the manual
--   intake cookie token or the enrollment browser token) AND requires the
--   row to be unowned. There is deliberately no claim keyed by UDID.
begin;

alter table public.manual_udid_requests
  add column user_id uuid null references auth.users(id) on delete set null;
create index manual_udid_user_created
  on public.manual_udid_requests(user_id, created_at desc);

alter table public.guest_enrollments
  add column user_id uuid null references auth.users(id) on delete set null;

-- Defence-in-depth read access for signed-in customers (server routes are
-- still the primary path). Column list deliberately excludes the encrypted
-- UDID, its lookup HMAC and the browser credential hash.
grant select (id, status, udid_suffix, device_label, source, consent_version,
  created_at, expires_at, user_id)
  on public.manual_udid_requests to authenticated;
drop policy if exists customer_read_own_udid_requests on public.manual_udid_requests;
create policy customer_read_own_udid_requests on public.manual_udid_requests
  for select to authenticated
  using (user_id is not null and user_id = (select auth.uid()));

-- UDID-data deletion requests raised from the account page, implementing
-- the draft privacy policy promise ("yêu cầu xóa ... xử lý trong vòng 30
-- ngày"). This repository deliberately does NOT write into the canonical
-- privacy_requests table: its live schema is not recorded here. Operators
-- process rows of this table and flip status once the data is deleted.
create table public.customer_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','processed','dismissed')),
  created_at timestamptz not null default now(),
  processed_at timestamptz null
);
create unique index customer_deletion_one_open_per_user
  on public.customer_deletion_requests(user_id) where status='pending';
create index customer_deletion_status_created
  on public.customer_deletion_requests(status, created_at);
alter table public.customer_deletion_requests enable row level security;
revoke all on public.customer_deletion_requests from public, anon, authenticated;
grant select, insert, update on public.customer_deletion_requests to service_role;

-- Attach a manual UDID request to its submitter's account. Only an unowned
-- row can be attached; the caller is the server route right after a
-- successful submit, with the user id from the verified session.
create function public.attach_manual_udid_request_owner(
  p_request_id uuid, p_user_id uuid
) returns boolean language plpgsql security invoker set search_path='' as $$
declare updated_id uuid;
begin
  if p_user_id is null then return false; end if;
  update public.manual_udid_requests set user_id=p_user_id
  where id=p_request_id and user_id is null
  returning id into updated_id;
  return updated_id is not null;
end $$;
revoke all on function public.attach_manual_udid_request_owner(uuid,uuid) from public, anon, authenticated;
grant execute on function public.attach_manual_udid_request_owner(uuid,uuid) to service_role;

-- Attach a guest enrollment session to its starter's account, so the later
-- device callback can pass ownership to the pending UDID request.
create function public.attach_guest_enrollment_owner(
  p_browser_hash text, p_user_id uuid
) returns boolean language plpgsql security invoker set search_path='' as $$
declare updated_id uuid;
begin
  if p_browser_hash !~ '^[a-f0-9]{64}$' or p_user_id is null then return false; end if;
  update public.guest_enrollments set user_id=p_user_id
  where browser_token_hash=p_browser_hash and user_id is null
  returning id into updated_id;
  return updated_id is not null;
end $$;
revoke all on function public.attach_guest_enrollment_owner(text,uuid) from public, anon, authenticated;
grant execute on function public.attach_guest_enrollment_owner(text,uuid) to service_role;

-- Claim: the person later signs in on the SAME browser that submitted the
-- manual request while logged out. Possession of the cookie token (only
-- its hash is presented) is the proof; an already-owned row never moves.
create function public.claim_manual_udid_requests(
  p_request_token_hash text, p_user_id uuid
) returns integer language plpgsql security invoker set search_path='' as $$
declare claimed integer;
begin
  if p_request_token_hash !~ '^[a-f0-9]{64}$' or p_user_id is null then return 0; end if;
  update public.manual_udid_requests set user_id=p_user_id
  where request_token_hash=p_request_token_hash and user_id is null;
  get diagnostics claimed = row_count;
  return claimed;
end $$;
revoke all on function public.claim_manual_udid_requests(text,uuid) from public, anon, authenticated;
grant execute on function public.claim_manual_udid_requests(text,uuid) to service_role;

create function public.claim_guest_enrollment_owner(
  p_browser_hash text, p_user_id uuid
) returns boolean language plpgsql security invoker set search_path='' as $$
declare updated_id uuid;
begin
  if p_browser_hash !~ '^[a-f0-9]{64}$' or p_user_id is null then return false; end if;
  update public.guest_enrollments set user_id=p_user_id
  where browser_token_hash=p_browser_hash and user_id is null
  returning id into updated_id;
  return updated_id is not null;
end $$;
revoke all on function public.claim_guest_enrollment_owner(text,uuid) from public, anon, authenticated;
grant execute on function public.claim_guest_enrollment_owner(text,uuid) to service_role;

-- Claim the pending request produced by a completed self-profile session:
-- matched through the UDID lookup HMAC recorded on BOTH the session and
-- the request when the device reported. The browser never re-types the
-- UDID; possession of the enrollment browser token is the proof.
create function public.claim_self_profile_udid_requests(
  p_browser_hash text, p_user_id uuid
) returns integer language plpgsql security invoker set search_path='' as $$
declare claimed integer;
begin
  if p_browser_hash !~ '^[a-f0-9]{64}$' or p_user_id is null then return 0; end if;
  update public.manual_udid_requests m set user_id=p_user_id
  from public.guest_enrollments g
  where g.browser_token_hash=p_browser_hash
    and g.udid_lookup_hmac is not null
    and m.udid_hmac=g.udid_lookup_hmac
    and m.source='self_profile'
    and m.user_id is null;
  get diagnostics claimed = row_count;
  return claimed;
end $$;
revoke all on function public.claim_self_profile_udid_requests(text,uuid) from public, anon, authenticated;
grant execute on function public.claim_self_profile_udid_requests(text,uuid) to service_role;

-- At device-callback time: copy the owner recorded on the enrollment
-- session onto the pending self-profile request it produced. The owner id
-- is read from the session row inside SQL — callers supply only the
-- challenge hash.
create function public.link_self_profile_request_to_enrollment(
  p_challenge_hash text
) returns boolean language plpgsql security invoker set search_path='' as $$
declare linked integer;
begin
  if p_challenge_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  update public.manual_udid_requests m set user_id=g.user_id
  from public.guest_enrollments g
  where g.challenge_hash=p_challenge_hash
    and g.user_id is not null
    and g.udid_lookup_hmac is not null
    and m.udid_hmac=g.udid_lookup_hmac
    and m.source='self_profile'
    and m.user_id is null;
  get diagnostics linked = row_count;
  return linked > 0;
end $$;
revoke all on function public.link_self_profile_request_to_enrollment(text) from public, anon, authenticated;
grant execute on function public.link_self_profile_request_to_enrollment(text) to service_role;

-- Raise (or reuse) the account's open UDID-data deletion request.
create function public.request_udid_data_deletion(
  p_user_id uuid
) returns uuid language plpgsql security invoker set search_path='' as $$
declare existing_id uuid;
begin
  if p_user_id is null then return null; end if;
  select id into existing_id from public.customer_deletion_requests
  where user_id=p_user_id and status='pending' limit 1;
  if existing_id is not null then return existing_id; end if;
  insert into public.customer_deletion_requests(user_id)
  values(p_user_id) returning id into existing_id;
  return existing_id;
end $$;
revoke all on function public.request_udid_data_deletion(uuid) from public, anon, authenticated;
grant execute on function public.request_udid_data_deletion(uuid) to service_role;
commit;
