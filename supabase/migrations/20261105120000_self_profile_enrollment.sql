-- Pragmatic self-serve Profile Service mode (device-reported trust level).
-- NOT YET APPLIED to the real Supabase project: apply together with the
-- owner's schema reconciliation before ENROLLMENT_SELF_PROFILE_ENABLED is
-- ever set to true.
--
-- The store serves its own .mobileconfig and accepts the device's response
-- WITHOUT verifying the Apple CMS certificate chain (extraction only).
-- Results are therefore self-asserted evidence, never identity proof:
--   * guest_enrollments completes as status 'device_reported' via a
--     dedicated RPC — the existing 'verified' path and its provider
--     attestation requirements are untouched;
--   * the UDID also lands in manual_udid_requests with source='self_profile'
--     and the same 'pending_unverified' status as a hand-typed submission.
-- Nothing in this migration grants OTA eligibility.
begin;

alter table public.guest_enrollments
  add column report_source text check (report_source in ('provider_attestation','self_profile')),
  add column reported_at timestamptz;

alter table public.guest_enrollments
  drop constraint if exists guest_enrollments_status_check;
alter table public.guest_enrollments
  add constraint guest_enrollments_status_check
  check (status in ('pending','verified','device_reported','rejected'));

alter table public.guest_enrollments drop constraint verified_requires_proof;
alter table public.guest_enrollments
  add constraint guest_enrollments_completion_proof check (
    (status = 'verified' and udid_ciphertext is not null and udid_lookup_hmac is not null
       and verified_at is not null and report_source is distinct from 'self_profile')
    or (status = 'device_reported' and udid_ciphertext is not null and udid_lookup_hmac is not null
       and verified_at is null and provider_reference is null
       and report_source = 'self_profile' and reported_at is not null)
    or (status in ('pending','rejected') and udid_ciphertext is null and udid_lookup_hmac is null
       and verified_at is null and report_source is null)
  );

-- Atomic one-time completion for the self-profile callback. Same anti-replay
-- shape as complete_guest_enrollment: only a still-pending, unexpired row
-- for the exact challenge hash can transition, exactly once. It can only
-- ever set 'device_reported' — there is no parameter that reaches 'verified'.
create function public.complete_guest_enrollment_self_report(
  p_challenge_hash text, p_udid_ciphertext text, p_udid_hmac text
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare updated_id uuid;
begin
  if p_challenge_hash !~ '^[a-f0-9]{64}$' or p_udid_hmac !~ '^[a-f0-9]{64}$'
    or length(p_udid_ciphertext) < 40 or length(p_udid_ciphertext) > 512 then
    return false;
  end if;
  update public.guest_enrollments
  set status='device_reported', udid_ciphertext=p_udid_ciphertext,
      udid_lookup_hmac=p_udid_hmac, reported_at=now(), report_source='self_profile'
  where challenge_hash=p_challenge_hash and status='pending' and expires_at>now()
  returning id into updated_id;
  return updated_id is not null;
end $$;
revoke all on function public.complete_guest_enrollment_self_report(text,text,text) from public, anon, authenticated;
grant execute on function public.complete_guest_enrollment_self_report(text,text,text) to service_role;

-- Record WHERE a pending UDID request came from. Existing rows and the
-- manual form keep the 'manual_form' default.
alter table public.manual_udid_requests
  add column source text not null default 'manual_form'
  check (source in ('manual_form','self_profile'));

-- Same quotas and duplicate guard as submit_manual_udid_request (the count
-- covers the whole table, so both intake paths share one per-IP budget),
-- inserting the pending request with its true source.
create function public.submit_self_profile_udid_request(
 p_request_token_hash text,p_ip_hmac text,p_udid_ciphertext text,
 p_udid_hmac text,p_udid_suffix text
) returns uuid language plpgsql security invoker set search_path='' as $$
declare inserted_id uuid;
begin
 if p_request_token_hash !~ '^[a-f0-9]{64}$' or p_ip_hmac !~ '^[a-f0-9]{64}$'
 or p_udid_hmac !~ '^[a-f0-9]{64}$' or p_udid_suffix !~ '^[A-F0-9]{4}$'
 or length(p_udid_ciphertext) not between 40 and 512 then
   raise exception 'invalid request';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_ip_hmac,0));
 if (select count(*) from public.manual_udid_requests where ip_hmac=p_ip_hmac
       and created_at > now()-interval '1 hour') >= 3 then
   raise exception 'rate limited';
 end if;
 if exists(select 1 from public.manual_udid_requests where udid_hmac=p_udid_hmac
      and status='pending_unverified' and created_at > now()-interval '24 hours') then
   raise exception 'duplicate pending request';
 end if;
 insert into public.manual_udid_requests(
   request_token_hash,ip_hmac,udid_ciphertext,udid_hmac,udid_suffix,device_label,consent_version,source
 ) values(p_request_token_hash,p_ip_hmac,p_udid_ciphertext,p_udid_hmac,p_udid_suffix,'','2026-11-03','self_profile')
 returning id into inserted_id;
 return inserted_id;
end $$;
revoke all on function public.submit_self_profile_udid_request(text,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.submit_self_profile_udid_request(text,text,text,text,text) to service_role;
commit;
