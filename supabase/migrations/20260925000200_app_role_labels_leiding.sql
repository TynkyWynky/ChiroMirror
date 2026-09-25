-- Keep all user-facing APP role labels in Dutch.
begin;

update public.app_roles set label = 'Leiding' where key = 'MEMBER';
update public.app_roles set label = 'Financiën' where key = 'TREASURER';

commit;
