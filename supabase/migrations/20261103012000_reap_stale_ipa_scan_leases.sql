-- Service-role-only timeout cleanup, never grants OTA or code-sign trust.
begin;
create function public.reap_expired_ipa_scans()
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
  lease_count integer := 0;
  expired_count integer := 0;
begin
  update public.ipa_upload_intakes as i
    set state='rejected',
        scan_error='SCAN_LEASE_EXHAUSTED',
        scan_finished_at=now(),
        scan_token=null,
        scan_lease_until=null,
        scan_report=null,
        sha256_verified=null,
        signature_trusted=false,
        install_eligible=false
    where i.state='scanning' and i.scan_lease_until<now()
      and i.scan_attempts>=3;
  get diagnostics lease_count = row_count;

  update public.ipa_upload_intakes as i
    set state='rejected',
        scan_error='INTAKE_EXPIRED',
        scan_finished_at=now(),
        scan_token=null,
        scan_lease_until=null,
        scan_report=null,
        sha256_verified=null,
        signature_trusted=false,
        install_eligible=false
    where i.state in ('reserved','uploaded_pending_scan','scanning')
      and i.expires_at<=now();
  get diagnostics expired_count = row_count;

  return jsonb_build_object('exhausted_leases',lease_count,'expired_intakes',expired_count);
end;
$$;
revoke all on function public.reap_expired_ipa_scans() from public,anon,authenticated;
grant execute on function public.reap_expired_ipa_scans() to service_role;
commit;
