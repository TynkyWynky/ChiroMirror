-- Keep user-facing APP role labels aligned with the Dutch APP terminology.
begin;

update public.app_roles
set label = 'Financiën'
where key = 'TREASURER';

commit;
