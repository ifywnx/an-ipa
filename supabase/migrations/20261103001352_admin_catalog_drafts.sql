begin;
-- A narrowly scoped RPC avoids granting private rights metadata on published
-- catalog rows to every authenticated user. No client can publish an IPA here.
create function private.admin_catalog(p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); target uuid; result jsonb; item public.apps; changes integer;
begin
 if actor is null or not exists(select 1 from public.roles where user_id=actor and role='admin')
  or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null and (banned_until is null or banned_until<=now())) then
  raise exception 'ACCESS_DENIED' using errcode='42501';
 end if;
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) into result from (
   select id,slug,name,developer,description,category,distribution_rights,rights_reference,published,updated_at
   from public.apps order by created_at desc limit 100
  ) a;
  return result;
 end if;
 if p_action='history' then
  select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) into result from (
   select id,action,entity,entity_id,created_at from public.audit_logs order by created_at desc limit 50
  ) a;
  return result;
 end if;
 if p_action not in ('save','hide') or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>20000 then
  raise exception 'INVALID_REQUEST' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('catalog-admin-'||actor::text,0));
 if (select count(*) from public.audit_logs where actor_id=actor and action in ('catalog.create','catalog.save','catalog.hide') and created_at>now()-interval '1 minute')>=30 then
  raise exception 'CATALOG_RATE_LIMIT' using errcode='P0001';
 end if;
 target:=nullif(p_data->>'id','')::uuid;
 if target is not null then
  select * into item from public.apps where id=target for update;
  if not found then raise exception 'APP_NOT_FOUND' using errcode='P0002'; end if;
  if p_data->>'updated_at' is null or item.updated_at<>(p_data->>'updated_at')::timestamptz then
   raise exception 'APP_CHANGED' using errcode='40001';
  end if;
 end if;
 if p_action='hide' then
  if target is null then raise exception 'APP_NOT_FOUND' using errcode='P0002'; end if;
  update public.apps set published=false where id=target;
 else
  if p_data ? 'published' or p_data ? 'publisher_id' then raise exception 'INVALID_FIELD' using errcode='22023'; end if;
  if coalesce(length(trim(p_data->>'category')),0)<1 then raise exception 'INVALID_CATEGORY' using errcode='22023'; end if;
  if target is null then
   insert into public.apps(slug,name,developer,description,category,distribution_rights,rights_reference,published,publisher_id)
   values(trim(p_data->>'slug'),trim(p_data->>'name'),trim(p_data->>'developer'),coalesce(p_data->>'description',''),trim(p_data->>'category'),p_data->>'distribution_rights',trim(p_data->>'rights_reference'),false,actor)
   returning id into target;
  else
   update public.apps set slug=trim(p_data->>'slug'),name=trim(p_data->>'name'),developer=trim(p_data->>'developer'),
    description=coalesce(p_data->>'description',''),category=trim(p_data->>'category'),distribution_rights=p_data->>'distribution_rights',
    rights_reference=trim(p_data->>'rights_reference'),published=false where id=target;
  end if;
 end if;
 insert into public.audit_logs(actor_id,action,entity,entity_id)
 values(actor,case when p_action='hide' then 'catalog.hide' when item.id is null then 'catalog.create' else 'catalog.save' end,'apps',target);
 return jsonb_build_object('id',target,'published',false);
end $$;
revoke all on function private.admin_catalog(text,jsonb) from public,anon;
grant execute on function private.admin_catalog(text,jsonb) to authenticated;
create function public.admin_catalog(p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_catalog(p_action,p_data); $$;
revoke all on function public.admin_catalog(text,jsonb) from public,anon;
grant execute on function public.admin_catalog(text,jsonb) to authenticated;
commit;
