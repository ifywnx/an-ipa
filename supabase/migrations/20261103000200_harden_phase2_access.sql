begin;
-- Phase 2 hardening: preserve catalog reads, prevent client-side mutations
-- until reviewed auth/RBAC, IPA validation, encrypted UDID and audit pipeline exist.
revoke select on public.apps from anon, authenticated;
grant select (id, slug, name, developer, description, category, icon_url, published, created_at)
  on public.apps to anon, authenticated;

revoke insert, update, delete on public.apps, public.app_versions,
  public.distribution_channels, public.devices, public.ipa_assets
  from authenticated;

drop policy if exists admin_apps on public.apps;
drop policy if exists admin_versions on public.app_versions;
drop policy if exists admin_channels on public.distribution_channels;
drop policy if exists create_asset on public.ipa_assets;
drop policy if exists staff_assets on public.ipa_assets;
drop policy if exists delete_asset on public.ipa_assets;
drop policy if exists register_device on public.devices;
drop policy if exists admin_update_device on public.devices;
drop policy if exists delete_device on public.devices;

-- The bucket stays private. No IPA upload/download access without a
-- verified worker and authorization backend.
drop policy if exists upload_quarantine on storage.objects;
drop policy if exists read_quarantine on storage.objects;
drop policy if exists delete_quarantine on storage.objects;

-- Restrict trigger helper invocation; existing triggers remain installed.
revoke execute on function private.touch() from public;
commit;
