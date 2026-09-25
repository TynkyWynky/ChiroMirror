-- Baseline APP access must remain read-only and non-administrative.
begin;

create or replace function public.guard_app_baseline_permission()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.role_key = 'MEMBER' and new.permission_key in (
    'members.manage', 'roles.manage', 'finance.treasury.manage',
    'tasks.manage_all', 'events.create', 'events.update', 'events.delete'
  ) then
    raise exception 'Forbidden permission for baseline APP role: %', new.permission_key using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists app_baseline_permission_guard on public.app_role_permissions;
create constraint trigger app_baseline_permission_guard
after insert or update on public.app_role_permissions
deferrable initially immediate
for each row execute function public.guard_app_baseline_permission();

do $$
begin
  if exists (
    select 1 from public.app_role_permissions
    where role_key = 'MEMBER' and permission_key in (
      'members.manage', 'roles.manage', 'finance.treasury.manage',
      'tasks.manage_all', 'events.create', 'events.update', 'events.delete'
    )
  ) then
    raise exception 'Baseline APP role already has a forbidden permission';
  end if;
end;
$$;

commit;
