begin;
create table public.manual_udid_requests (
  id uuid primary key default gen_random_uuid(),
  request_token_hash text not null unique check(request_token_hash ~ '^[a-f0-9]{64}$'),
  ip_hmac text not null check(ip_hmac ~ '^[a-f0-9]{64}$'),
  udid_ciphertext text not null check(length(udid_ciphertext) between 40 and 512),
  udid_hmac text not null check(udid_hmac ~ '^[a-f0-9]{64}$'),
  udid_suffix text not null check(udid_suffix ~ '^[A-F0-9]{4}$'),
  device_label text not null default '' check(length(device_label)<=80),
  status text not null default 'pending_unverified' check(status in ('pending_unverified','reviewed_unverified','rejected')),
  consent_version text not null check(consent_version='2026-11-03'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '30 days')
);
create index manual_udid_ip_created on public.manual_udid_requests(ip_hmac,created_at desc);
create index manual_udid_expires on public.manual_udid_requests(expires_at);
create index manual_udid_hmac_idx on public.manual_udid_requests(udid_hmac);
alter table public.manual_udid_requests enable row level security;
revoke all on public.manual_udid_requests from public,anon,authenticated;

create function public.submit_manual_udid_request(
 p_request_token_hash text,p_ip_hmac text,p_udid_ciphertext text,
 p_udid_hmac text,p_udid_suffix text,p_device_label text
) returns uuid language plpgsql security invoker set search_path='' as $$
declare inserted_id uuid;
begin
 if p_request_token_hash !~ '^[a-f0-9]{64}$' or p_ip_hmac !~ '^[a-f0-9]{64}$'
 or p_udid_hmac !~ '^[a-f0-9]{64}$' or p_udid_suffix !~ '^[A-F0-9]{4}$'
 or length(p_udid_ciphertext) not between 40 and 512 or length(p_device_label)>80 then
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
   request_token_hash,ip_hmac,udid_ciphertext,udid_hmac,udid_suffix,device_label,consent_version
 ) values(p_request_token_hash,p_ip_hmac,p_udid_ciphertext,p_udid_hmac,p_udid_suffix,p_device_label,'2026-11-03')
 returning id into inserted_id;
 return inserted_id;
end $$;
revoke all on function public.submit_manual_udid_request(text,text,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.submit_manual_udid_request(text,text,text,text,text,text) to service_role;
commit;