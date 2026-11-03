begin;
do $$ declare actor uuid; begin
 select user_id into actor from public.roles where role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 if has_function_privilege('anon','public.admin_catalog(text,jsonb)','execute') then raise exception 'ANON_RPC_EXPOSED'; end if;
 if has_table_privilege('authenticated','public.apps','update') then raise exception 'DIRECT_UPDATE_EXPOSED'; end if;
end $$;
set local role authenticated;
do $$
declare result jsonb; payload jsonb; item jsonb; target uuid; denied boolean:=false;
begin
 payload:=jsonb_build_object('slug','synthetic-'||substr(gen_random_uuid()::text,1,8),'name','Synthetic draft','developer','Test','category','Test','description','Not real data','distribution_rights','own','rights_reference','Synthetic rights test');
 result:=public.admin_catalog('save',payload); target:=(result->>'id')::uuid;
 if result->>'published'<>'false' then raise exception 'DRAFT_PUBLISHED'; end if;
 if exists(select 1 from public.apps where id=target) then raise exception 'DRAFT_VISIBLE_THROUGH_PUBLIC_CATALOG'; end if;
 select value into item from jsonb_array_elements(public.admin_catalog('list')) where value->>'id'=target::text;
 if item is null then raise exception 'ADMIN_CANNOT_LIST'; end if;
 begin perform public.admin_catalog('save',payload||jsonb_build_object('published',true)); exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'PUBLISH_ACCEPTED'; end if;
 denied:=false;
 begin perform public.admin_catalog('hide',jsonb_build_object('id',target,'updated_at','2000-01-01T00:00:00Z')); exception when serialization_failure then denied:=true; end;
 if not denied then raise exception 'STALE_EDIT_ACCEPTED'; end if;
 perform public.admin_catalog('save',payload||jsonb_build_object('id',target,'updated_at',item->>'updated_at','name','Edited synthetic'));
 if not exists(select 1 from jsonb_array_elements(public.admin_catalog('history')) value where value->>'entity_id'=target::text and value->>'action'='catalog.save') then raise exception 'AUDIT_MISSING'; end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 denied:=false;
 begin perform public.admin_catalog('list'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'NONADMIN_ACCEPTED'; end if;
end $$;
reset role;
select 'catalog authorization, drafts, publication denial, concurrency and audit assertions passed' as result;
rollback;
