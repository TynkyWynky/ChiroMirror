-- Run ONCE after install-app.sql and verify-app.sql, as the database administrator.
-- Replace the email below with ONE independently verified existing Auth account.
-- This grants only APP_ADMIN, never SITE/admin or TREASURER, and creates no account.
-- Re-running for that same first administrator is harmless. If another manager
-- already exists, use the APP role interface instead of this bootstrap script.
-- After login, add/link this person's member in APP > Membres for personal modules.
begin;
do $bootstrap$
declare
  target_email text := 'REPLACE_WITH_VERIFIED_EMAIL';
  target_id uuid;
  matching_accounts integer;
begin
  if target_email = 'REPLACE_WITH_VERIFIED_EMAIL' or btrim(target_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Set target_email to one verified existing Auth account before running this bootstrap';
  end if;
  if to_regclass('public.app_user_roles') is null then
    raise exception 'Install and verify the APP migrations before bootstrapping access';
  end if;
  perform pg_advisory_xact_lock(20260922, 2);
  select count(*) into matching_accounts from auth.users where lower(email) = lower(btrim(target_email));
  if matching_accounts <> 1 then
    raise exception 'Expected exactly one Auth account for the selected email; no access granted';
  end if;
  select id into target_id from auth.users where lower(email) = lower(btrim(target_email));
  if not exists (select 1 from public.profiles where user_id = target_id) then
    raise exception 'The selected Auth account has no SITE profile; repair that account before granting APP access';
  end if;
  if exists (select 1 from public.app_user_roles ur
    join public.app_role_permissions rp on rp.role_key = ur.role_key
    where rp.permission_key = 'roles.manage' and ur.user_id <> target_id) then
    raise exception 'An APP role manager already exists; use its APP interface to assign further roles';
  end if;
  insert into public.app_user_roles(user_id, role_key) values (target_id, 'APP_ADMIN')
    on conflict (user_id, role_key) do nothing;
end;
$bootstrap$;
commit;
