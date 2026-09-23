-- Existing installations only. See ../README.md before applying.
-- Preserve all existing users, roles, content and storage objects.
begin;

-- Fail atomically on schema drift rather than silently changing an unknown setup.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_role_check' and contype = 'c'
  ) then
    raise exception 'Expected profiles_role_check is missing. Review the live schema first.';
  end if;
end;
$$;

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('none', 'admin', 'editor'));
alter table public.profiles alter column role set default 'none';

create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Never accept authorization from user-editable auth metadata.
  insert into public.profiles (user_id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'none'
  )
  on conflict (user_id) do update
  set email = excluded.email,
      full_name = case
        when public.profiles.full_name = '' then excluded.full_name
        else public.profiles.full_name
      end;
  return new;
end;
$$;

create or replace function public.can_manage_group(target_group_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid()
      and (
        role = 'admin'
        or (
          role = 'editor'
          and coalesce(target_group_slug, '') <> ''
          and exists (
            select 1
            from jsonb_array_elements_text(coalesce(managed_group_slugs, '[]'::jsonb)) as managed_slug
            where managed_slug = target_group_slug
          )
        )
      )
  );
$$;

commit;
