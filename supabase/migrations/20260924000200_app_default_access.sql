-- Phase 6: every authenticated account gets baseline APP access.
-- Baseline permissions are derived from MEMBER without inserting a role row.
-- Explicit APP roles remain reserved for elevated capabilities.
begin;

create or replace function public.has_app_permission(permission_key text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.app_role_permissions rp
      where rp.role_key = 'MEMBER' and rp.permission_key = $1
    )
    or exists (
      select 1 from public.app_user_roles ur
      join public.app_role_permissions rp on rp.role_key = ur.role_key
      where ur.user_id = auth.uid() and rp.permission_key = $1
    )
  );
$$;

create or replace function public.has_app_access()
returns boolean language sql stable security definer set search_path = ''
as $$ select auth.uid() is not null; $$;

create or replace function public.get_my_app_access()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'permissions', coalesce((select jsonb_agg(distinct rp.permission_key)
      from public.app_role_permissions rp
      where auth.uid() is not null and (
        rp.role_key = 'MEMBER' or exists (
          select 1 from public.app_user_roles ur
          where ur.user_id = auth.uid() and ur.role_key = rp.role_key
        )
      )), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'label', r.label, 'system', r.system)
      order by case when r.key = 'MEMBER' then 0 else 1 end, r.key)
      from public.app_roles r
      where auth.uid() is not null and (r.key = 'MEMBER' or exists (
        select 1 from public.app_user_roles ur
        where ur.user_id = auth.uid() and ur.role_key = r.key
      ))), '[]'::jsonb),
    'member', (select to_jsonb(m) from public.members m where m.user_id = auth.uid()
      and public.has_app_permission('members.read'))
  );
$$;

revoke all on function public.has_app_permission(text), public.has_app_access(), public.get_my_app_access()
  from public, anon, authenticated;
grant execute on function public.has_app_permission(text), public.has_app_access(), public.get_my_app_access() to authenticated;

commit;
