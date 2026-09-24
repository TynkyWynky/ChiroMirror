-- Compatibility for SITE installations predating per-group finance permissions.
-- Existing assignments and SITE roles are preserved. An empty list grants no
-- additional group permissions. Apply before 20260922000100_neutral_site_role.
begin;

alter table public.profiles
  add column if not exists managed_group_slugs jsonb not null default '[]'::jsonb;

-- Refuse an incompatible existing column rather than coercing authorization data.
do $$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.profiles'::regclass
      and attname = 'managed_group_slugs' and not attisdropped
      and atttypid = 'jsonb'::regtype
  ) then
    raise exception 'profiles.managed_group_slugs must be jsonb; inspect the existing column before migrating';
  end if;
end;
$$;

commit;
