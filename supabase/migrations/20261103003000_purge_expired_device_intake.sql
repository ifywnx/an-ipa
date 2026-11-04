-- Applied to dedicated AN IPA STORE Supabase: name purge_expired_device_intake.
-- This function cannot be executed by anon/authenticated users.
begin;
create function public.purge_expired_device_intake()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  guest_count integer := 0;
  manual_count integer := 0;
begin
  delete from public.guest_enrollments
  where expires_at <= now();
  get diagnostics guest_count = row_count;
  delete from public.manual_udid_requests
  where expires_at <= now();
  get diagnostics manual_count = row_count;
  return jsonb_build_object('guest_expired', guest_count,
                            'manual_expired', manual_count);
end
$$;
revoke all on function public.purge_expired_device_intake()
  from public, anon, authenticated;
grant execute on function public.purge_expired_device_intake()
  to service_role;
commit;
