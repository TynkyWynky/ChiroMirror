-- Phase 1. Requires Phase 0; no automatic user/member/role assignments.
begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'role'
      and column_default = '''none''::text'
  ) then
    raise exception 'Apply 20260922000100_neutral_site_role before Phase 1';
  end if;
end;
$$;

create table public.members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  first_name text not null check (first_name = btrim(first_name) and char_length(first_name) between 1 and 100),
  last_name text not null check (last_name = btrim(last_name) and char_length(last_name) between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index members_active_name_idx on public.members(active, last_name, first_name, id);

create table public.app_roles (
  key text primary key,
  label text not null,
  system boolean not null default true
);
create table public.app_permissions (
  key text primary key,
  description text not null
);
create table public.app_role_permissions (
  role_key text references public.app_roles(key) on delete restrict,
  permission_key text references public.app_permissions(key) on delete restrict,
  primary key (role_key, permission_key)
);
create index app_role_permissions_permission_idx on public.app_role_permissions(permission_key, role_key);
create table public.app_user_roles (
  user_id uuid references auth.users(id) on delete cascade,
  role_key text references public.app_roles(key) on delete restrict,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_key)
);
create index app_user_roles_role_idx on public.app_user_roles(role_key, user_id);

insert into public.app_roles(key, label) values
  ('APP_ADMIN', 'APP-beheerder'), ('RESPONSIBLE', 'Verantwoordelijke'),
  ('TREASURER', 'Penningmeester'), ('MEMBER', 'Lid');
insert into public.app_permissions(key, description) values
  ('app.access', 'Interne toepassing openen'), ('members.read', 'Leden lezen'),
  ('members.manage', 'Leden beheren'), ('roles.read', 'APP-toewijzingen lezen'),
  ('roles.manage', 'APP-rollen toewijzen');
insert into public.app_role_permissions(role_key, permission_key)
  select r.key, p.key from public.app_roles r cross join public.app_permissions p
  where r.key = 'APP_ADMIN' or p.key in ('app.access', 'members.read');

create function public.has_app_permission(permission_key text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.app_user_roles ur
    join public.app_role_permissions rp on rp.role_key = ur.role_key
    where ur.user_id = auth.uid() and rp.permission_key = $1
  );
$$;
create function public.has_app_access()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.has_app_permission('app.access'); $$;

alter table public.members enable row level security;
alter table public.app_roles enable row level security;
alter table public.app_permissions enable row level security;
alter table public.app_role_permissions enable row level security;
alter table public.app_user_roles enable row level security;

-- Explicit grants: do not depend on a project's default privileges.
revoke all on public.members, public.app_roles, public.app_permissions,
  public.app_role_permissions, public.app_user_roles from public, anon, authenticated;
grant select on public.members, public.app_roles, public.app_permissions,
  public.app_role_permissions, public.app_user_roles to authenticated;
grant insert (user_id, first_name, last_name, active),
  update (user_id, first_name, last_name, active) on public.members to authenticated;

create policy members_read on public.members for select to authenticated
  using (public.has_app_access() and public.has_app_permission('members.read'));
create policy members_insert on public.members for insert to authenticated
  with check (public.has_app_access() and public.has_app_permission('members.manage'));
create policy members_update on public.members for update to authenticated
  using (public.has_app_access() and public.has_app_permission('members.manage'))
  with check (public.has_app_access() and public.has_app_permission('members.manage'));
-- No DELETE policy or grant. Archiving does not revoke a linked account's roles.

create policy app_roles_read on public.app_roles for select to authenticated
  using (public.has_app_access() and (public.has_app_permission('roles.read') or exists (
    select 1 from public.app_user_roles ur where ur.user_id = auth.uid() and ur.role_key = key
  )));
create policy app_permissions_read on public.app_permissions for select to authenticated
  using (public.has_app_access());
create policy app_role_permissions_read on public.app_role_permissions for select to authenticated
  using (public.has_app_access() and (public.has_app_permission('roles.read') or exists (
    select 1 from public.app_user_roles ur where ur.user_id = auth.uid() and ur.role_key = app_role_permissions.role_key
  )));
create policy app_user_roles_read on public.app_user_roles for select to authenticated
  using (public.has_app_access() and (user_id = auth.uid() or public.has_app_permission('roles.read')));
-- Role catalogs/matrix are system-owned. Assignments can only change via the RPC below.

create function public.touch_member_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;
create trigger members_updated_at before update on public.members
  for each row execute function public.touch_member_updated_at();

create function public.get_my_app_access()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'permissions', coalesce((select jsonb_agg(distinct rp.permission_key)
      from public.app_user_roles ur join public.app_role_permissions rp on rp.role_key = ur.role_key
      where ur.user_id = auth.uid()), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'label', r.label, 'system', r.system))
      from public.app_user_roles ur join public.app_roles r on r.key = ur.role_key
      where ur.user_id = auth.uid() and public.has_app_access()), '[]'::jsonb),
    'member', (select to_jsonb(m) from public.members m where m.user_id = auth.uid()
      and public.has_app_access() and public.has_app_permission('members.read'))
  );
$$;

-- Account email comes from Auth, not editable profile.email. No anonymous directory.
create function public.list_app_accounts()
returns table(user_id uuid, email text, full_name text, member_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_app_access() or not (
    public.has_app_permission('members.manage') or public.has_app_permission('roles.manage')
  ) then raise exception 'APP account directory forbidden' using errcode = '42501'; end if;
  return query select u.id, u.email::text, p.full_name, m.id
    from auth.users u join public.profiles p on p.user_id = u.id
    left join public.members m on m.user_id = u.id order by p.full_name, u.id;
end;
$$;

create function public.set_app_user_roles(target_user_id uuid, role_keys text[])
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_app_access() or not public.has_app_permission('roles.manage') then
    raise exception 'APP role management forbidden' using errcode = '42501';
  end if;
  -- Serialize permission changes, then recheck authority after the lock.
  perform pg_advisory_xact_lock(20260922, 2);
  if not public.has_app_access() or not public.has_app_permission('roles.manage') then
    raise exception 'APP role management forbidden' using errcode = '42501';
  end if;
  if role_keys is null or cardinality(role_keys) > 20 or exists (
    select 1 from unnest(role_keys) k where k is null or not exists (select 1 from public.app_roles r where r.key = k)
  ) then raise exception 'Invalid APP roles' using errcode = '22023'; end if;
  if not exists (select 1 from auth.users where id = target_user_id) then
    raise exception 'Account not found' using errcode = '22023';
  end if;
  if exists (select 1 from public.app_user_roles ur join public.app_role_permissions rp on rp.role_key = ur.role_key
      where ur.user_id = target_user_id and rp.permission_key = 'roles.manage')
    and not exists (select 1 from public.app_role_permissions where role_key = any(role_keys) and permission_key = 'roles.manage')
    and not exists (select 1 from public.app_user_roles ur join public.app_role_permissions rp on rp.role_key = ur.role_key
      where ur.user_id <> target_user_id and rp.permission_key = 'roles.manage') then
    raise exception 'Keep at least one APP role manager' using errcode = '23514';
  end if;
  delete from public.app_user_roles where user_id = target_user_id and not (role_key = any(role_keys));
  insert into public.app_user_roles(user_id, role_key, assigned_by)
    select target_user_id, k, auth.uid() from (select distinct unnest(role_keys) k) selected
    on conflict (user_id, role_key) do nothing;
end;
$$;

-- Auth invitation is external; linking and granting roles must succeed or fail together.
create function public.complete_app_member_invitation(target_member_id uuid, target_user_id uuid, role_keys text[])
returns void language plpgsql security definer set search_path = ''
as $$
declare linked_user uuid;
begin
  if not public.has_app_access() or not public.has_app_permission('members.manage')
    or not public.has_app_permission('roles.manage') then
    raise exception 'APP invitation completion forbidden' using errcode = '42501';
  end if;
  -- Same lock order as role management. A second completion must not overwrite a link.
  perform pg_advisory_xact_lock(20260922, 2);
  if not public.has_app_access() or not public.has_app_permission('members.manage')
    or not public.has_app_permission('roles.manage') then
    raise exception 'APP invitation completion forbidden' using errcode = '42501';
  end if;
  select m.user_id into linked_user from public.members m where m.id = target_member_id for update;
  if not found or linked_user is not null then
    raise exception 'Member unavailable or already linked' using errcode = '22023';
  end if;
  perform public.set_app_user_roles(target_user_id, role_keys);
  update public.members set user_id = target_user_id where id = target_member_id;
end;
$$;

revoke all on function public.complete_app_member_invitation(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.complete_app_member_invitation(uuid, uuid, text[]) to authenticated;

revoke all on function public.has_app_permission(text), public.has_app_access(),
  public.get_my_app_access(), public.list_app_accounts(), public.set_app_user_roles(uuid, text[]),
  public.touch_member_updated_at() from public, anon, authenticated;
grant execute on function public.has_app_permission(text), public.has_app_access(),
  public.get_my_app_access(), public.list_app_accounts(), public.set_app_user_roles(uuid, text[]) to authenticated;

commit;
