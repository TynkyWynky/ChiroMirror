-- READ ONLY. Run in the target Supabase SQL Editor before and after installation.
-- Missing rows/false flags require inspection; PGRST205 alone does not prove a
-- missing database table, because PostgREST may have a stale schema cache.
select expected.name as table_name, c.oid is not null as installed,
  coalesce(c.relrowsecurity, false) as rls_enabled
from (values
  ('members'), ('app_roles'), ('app_permissions'), ('app_role_permissions'), ('app_user_roles'),
  ('event_categories'), ('events'), ('event_participants'), ('event_occurrence_overrides'), ('event_reminders'),
  ('tasks'), ('task_members'), ('task_activity'), ('task_reminders'),
  ('app_financial_entities'), ('app_finance_transactions'), ('app_expense_shares'),
  ('app_finance_obligations'), ('app_finance_payments'), ('app_payment_allocations'), ('app_finance_activity'),
  ('notification_preferences'), ('notification_category_preferences'), ('push_subscriptions'),
  ('notification_rebuild_queue'), ('notification_jobs'), ('notifications'), ('notification_deliveries')
) expected(name)
left join pg_namespace n on n.nspname = 'public'
left join pg_class c on c.relnamespace = n.oid and c.relname = expected.name and c.relkind = 'r'
order by expected.name;

select expected.signature, p.oid is not null as installed,
  case when p.oid is not null then has_function_privilege('authenticated', p.oid, 'EXECUTE') else false end as authenticated_can_execute,
  case when p.oid is not null then has_function_privilege('anon', p.oid, 'EXECUTE') else false end as anon_can_execute
from (values
  ('public.get_my_app_access()'), ('public.list_app_accounts()'),
  ('public.set_app_user_roles(uuid,text[])'),
  ('public.save_agenda_event_with_reminders(uuid,bigint,jsonb,uuid[],jsonb)'),
  ('public.save_task_with_reminders(uuid,bigint,jsonb,jsonb,jsonb)'),
  ('public.get_app_finance_snapshot()'), ('public.save_notification_preferences(jsonb,jsonb)'),
  ('public.claim_notification_sources(integer)')
) expected(signature)
left join pg_proc p on p.oid = to_regprocedure(expected.signature);
-- Expected: installed=true throughout; anon_can_execute=false throughout.
-- authenticated_can_execute=true except claim_notification_sources (worker only).

select column_default as new_site_profile_role
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'role';
-- Expected after installation: 'none'::text.

-- After the tables are confirmed installed, check the chosen account's APP roles:
-- select u.email, r.role_key from auth.users u
-- join public.app_user_roles r on r.user_id = u.id
-- where lower(u.email) = lower('REPLACE_WITH_VERIFIED_EMAIL');
