-- Integration assertions; all synthetic rows are rolled back. No storage operations.
begin;
do $$
declare actor uuid; receipt uuid:=gen_random_uuid(); lease uuid; newer uuid; changed boolean;
begin
 select user_id into actor from public.roles where role='admin' limit 1;
 if actor is null then raise exception 'TEST_REQUIRES_ADMIN'; end if;
 if has_function_privilege('anon','public.claim_ipa_scan_receipt(uuid)','execute') or has_function_privilege('authenticated','public.claim_ipa_cleanup(uuid)','execute') then raise exception 'PUBLIC_WORKER_ACCESS'; end if;
 insert into public.ipa_upload_intakes(id,requested_by,filename,expected_bytes,object_key,state,expires_at)
 values(receipt,actor,'synthetic-test.ipa',123,'quarantine/'||receipt||'.ipa','uploaded_pending_scan',now()+interval '1 hour');
 select scan_token into lease from public.claim_ipa_scan_receipt(receipt);
 if lease is null then raise exception 'CLAIM_FAILED'; end if;
 if exists(select 1 from public.claim_ipa_scan_receipt(receipt)) then raise exception 'DUPLICATE_LEASE'; end if;
 if public.finish_ipa_scan(receipt,gen_random_uuid(),'rejected',null,null,'TEST_ERROR') then raise exception 'STALE_TOKEN_ACCEPTED'; end if;
 changed:=public.finish_ipa_scan(receipt,lease,'uploaded_pending_scan',null,null,'TEST_RETRY');
 if not changed then raise exception 'RETRY_FAILED'; end if;
 if exists(select 1 from public.claim_ipa_scan_receipt(receipt)) then raise exception 'BACKOFF_IGNORED'; end if;
 update public.ipa_upload_intakes set next_scan_at=now()-interval '1 second' where id=receipt;
 select scan_token into newer from public.claim_ipa_scan_receipt(receipt);
 if newer is null or newer=lease then raise exception 'TOKEN_NOT_ROTATED'; end if;
 if public.finish_ipa_scan(receipt,lease,'rejected',null,null,'TEST_ERROR') then raise exception 'OLD_TOKEN_ACCEPTED'; end if;
 if not public.finish_ipa_scan(receipt,newer,'rejected',null,null,'TEST_REJECTED') then raise exception 'FINALIZE_FAILED'; end if;
 if exists(select 1 from public.ipa_upload_intakes where id=receipt and (signature_trusted or install_eligible or delete_after>now()+interval '1 day')) then raise exception 'TRUST_OR_RETENTION_INVALID'; end if;
 if exists(select 1 from public.claim_ipa_cleanup(receipt)) then raise exception 'EARLY_DELETE'; end if;
 update public.ipa_upload_intakes set delete_after=now()-interval '1 second' where id=receipt;
 select cleanup_token into lease from public.claim_ipa_cleanup(receipt);
 if lease is null then raise exception 'CLEANUP_CLAIM_FAILED'; end if;
 if public.finish_ipa_cleanup(receipt,gen_random_uuid(),true) then raise exception 'CLEANUP_STALE_TOKEN'; end if;
 if not public.finish_ipa_cleanup(receipt,lease,true) then raise exception 'CLEANUP_FAILED'; end if;
 if exists(select 1 from public.claim_ipa_cleanup(receipt)) then raise exception 'CLEANUP_REPLAY'; end if;
end $$;
select 'worker lease, backoff, token, retention and grants assertions passed' as result;
rollback;
