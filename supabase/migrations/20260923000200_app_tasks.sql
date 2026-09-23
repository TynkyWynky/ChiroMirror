-- Phase 3: tasks. Additive, after Agenda. No automatic member/account assignments.
begin;
insert into public.app_permissions(key,description) values
 ('tasks.create_team','Créer une tâche d’équipe'),('tasks.read_all','Lire toutes les tâches d’équipe'),('tasks.manage_all','Administrer les tâches d’équipe');
insert into public.app_role_permissions(role_key,permission_key) values
 ('APP_ADMIN','tasks.create_team'),('APP_ADMIN','tasks.read_all'),('APP_ADMIN','tasks.manage_all'),
 ('RESPONSIBLE','tasks.create_team'),('RESPONSIBLE','tasks.read_all');

create table public.tasks (
 id uuid primary key default gen_random_uuid(),
 scope text not null check (scope in ('PERSONAL','TEAM')),
 owner_member_id uuid references public.members(id) on delete restrict,
 -- Bind private data to its actual account as well: relinking a member is not a privacy bypass.
 owner_user_id uuid references auth.users(id) on delete set null,
 title text not null check (title = btrim(title) and title ~ '[^[:space:]]' and char_length(title) <= 200),
 description text check (char_length(description) <= 10000),
 status text not null default 'TODO' check (status in ('TODO','IN_PROGRESS','DONE','CANCELLED')),
 priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
 deadline_date date check (deadline_date between date '2000-01-01' and date '2100-12-31'),
 deadline_at timestamptz check ((deadline_at at time zone 'Europe/Brussels')::date between date '2000-01-01' and date '2100-12-31'),
 timezone text not null default 'Europe/Brussels' check (timezone = 'Europe/Brussels'),
 event_id uuid references public.events(id) on delete restrict,
 event_occurrence_date date,
 created_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision bigint not null default 1,
 check (deadline_date is null or deadline_at is null),
 check (event_occurrence_date is null or event_id is not null),
 check ((scope = 'PERSONAL' and owner_member_id is not null and event_id is null and event_occurrence_date is null)
   or (scope = 'TEAM' and owner_member_id is null and owner_user_id is null))
);
create index tasks_owner_idx on public.tasks(owner_user_id,owner_member_id) where scope='PERSONAL';
create index tasks_team_status_idx on public.tasks(status,priority) where scope='TEAM';
create index tasks_deadline_date_idx on public.tasks(deadline_date);
create index tasks_deadline_at_idx on public.tasks(deadline_at);
create index tasks_event_idx on public.tasks(event_id,event_occurrence_date);
create table public.task_members (
 task_id uuid not null references public.tasks(id) on delete restrict,
 member_id uuid not null references public.members(id) on delete restrict,
 role text not null check (role in ('LEAD','CONTRIBUTOR')),
 work_status text not null default 'TODO' check (work_status in ('TODO','DONE')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(task_id,member_id)
);
create index task_members_member_idx on public.task_members(member_id,role,task_id);
create table public.task_activity (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.tasks(id) on delete restrict,
 actor_id uuid references auth.users(id) on delete set null,
 action text not null check (action in ('TASK_CREATED','TASK_UPDATED','STATUS_CHANGED','TASK_CANCELLED',
   'MEMBER_ADDED','MEMBER_REMOVED','MEMBER_ROLE_CHANGED','MEMBER_WORK_COMPLETED','MEMBER_WORK_REOPENED')),
 metadata jsonb not null default '{}' check (jsonb_typeof(metadata)='object'),
 created_at timestamptz not null default clock_timestamp()
);
create index task_activity_task_idx on public.task_activity(task_id,created_at,id);
create table public.task_reminders (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.tasks(id) on delete restrict,
 kind text not null check (kind in ('OFFSET','LOCAL_TIME','ABSOLUTE')),
 offset_minutes integer check (offset_minutes between 0 and 525600),
 days_before integer check (days_before between 0 and 365), local_time time, scheduled_at timestamptz,
 timezone text not null default 'Europe/Brussels' check (timezone='Europe/Brussels'),
 check ((kind='OFFSET' and offset_minutes is not null and days_before is null and local_time is null and scheduled_at is null)
  or (kind='LOCAL_TIME' and offset_minutes is null and days_before is not null and local_time is not null and scheduled_at is null)
  or (kind='ABSOLUTE' and offset_minutes is null and days_before is null and local_time is null and scheduled_at is not null))
);
create index task_reminders_task_idx on public.task_reminders(task_id);

create function public.task_current_member_id() returns uuid language sql stable security definer set search_path='' as $$
 select id from public.members where user_id=auth.uid();
$$;
create function public.can_read_task(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_app_access() and exists (select 1 from public.tasks t where t.id=target and (
  (t.scope='PERSONAL' and t.owner_user_id=auth.uid() and t.owner_member_id=public.task_current_member_id())
  or (t.scope='TEAM' and (public.has_app_permission('tasks.read_all') or public.has_app_permission('tasks.manage_all')
   or (t.created_by=auth.uid() and public.has_app_permission('tasks.create_team'))
   or exists (select 1 from public.task_members tm where tm.task_id=t.id and tm.member_id=public.task_current_member_id())))
 ));
$$;
create function public.can_manage_task(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_app_access() and exists (select 1 from public.tasks t where t.id=target and (
  (t.scope='PERSONAL' and t.owner_user_id=auth.uid() and t.owner_member_id=public.task_current_member_id())
  or (t.scope='TEAM' and (public.has_app_permission('tasks.manage_all')
   or (t.created_by=auth.uid() and public.has_app_permission('tasks.create_team'))
   or exists (select 1 from public.task_members tm where tm.task_id=t.id and tm.member_id=public.task_current_member_id() and tm.role='LEAD')))
 ));
$$;
alter table public.tasks enable row level security;
alter table public.task_members enable row level security;
alter table public.task_activity enable row level security;
alter table public.task_reminders enable row level security;
revoke all on public.tasks,public.task_members,public.task_activity,public.task_reminders from public,anon,authenticated;
grant select on public.tasks,public.task_members,public.task_activity,public.task_reminders to authenticated;
create policy tasks_read on public.tasks for select to authenticated using (public.can_read_task(id));
create policy task_members_read on public.task_members for select to authenticated using (public.can_read_task(task_id));
create policy task_activity_read on public.task_activity for select to authenticated using (public.can_read_task(task_id));
create policy task_reminders_read on public.task_reminders for select to authenticated using (public.can_read_task(task_id));
-- All writes, including audit, are through controlled RPCs; no direct DML grants.

create function public.save_task(target_id uuid, expected_revision bigint, details jsonb, assignments jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare candidate public.tasks; previous public.tasks; saved public.tasks; actor_member uuid; linked public.events;
 changed_fields jsonb; current_assignment record;
begin
 if not public.has_app_access() then raise exception 'Task permission denied' using errcode='42501'; end if;
 if jsonb_typeof(details) is distinct from 'object' or jsonb_typeof(assignments) is distinct from 'array'
   or jsonb_array_length(assignments)>5000 then raise exception 'Invalid task input' using errcode='22023'; end if;
 candidate := jsonb_populate_record(null::public.tasks,details);
 actor_member := public.task_current_member_id();
 if target_id is null then
   if candidate.scope='PERSONAL' then
     if actor_member is null or not exists (select 1 from public.members m where m.id=actor_member and m.active) then
       raise exception 'An active linked member is required' using errcode='42501'; end if;
   elsif candidate.scope='TEAM' then
     if not public.has_app_permission('tasks.create_team') then raise exception 'Task permission denied' using errcode='42501'; end if;
   else raise exception 'Invalid task scope' using errcode='22023'; end if;
 else
   -- Check authorization before returning revision/existence information.
   if not public.can_manage_task(target_id) then raise exception 'Task permission denied' using errcode='42501'; end if;
   select * into previous from public.tasks where id=target_id for update;
   if not public.can_manage_task(target_id) then raise exception 'Task permission denied' using errcode='42501'; end if;
   if previous.revision is distinct from expected_revision then raise exception 'Task changed; reload' using errcode='40001'; end if;
   if candidate.scope is distinct from previous.scope then raise exception 'Task scope is immutable' using errcode='22023'; end if;
 end if;
 if candidate.scope='PERSONAL' then
   if jsonb_array_length(assignments)<>0 or candidate.event_id is not null or candidate.event_occurrence_date is not null then
     raise exception 'Personal tasks cannot have collaborators or an event' using errcode='22023'; end if;
 else
   if exists (select 1 from jsonb_array_elements(assignments) x where jsonb_typeof(x) is distinct from 'object') then
     raise exception 'Invalid task members' using errcode='22023'; end if;
   if not exists (select 1 from jsonb_to_recordset(assignments) as a(member_id uuid,role text) where a.role='LEAD')
    or exists (select 1 from jsonb_to_recordset(assignments) as a(member_id uuid,role text) where a.member_id is null or a.role is null or a.role not in ('LEAD','CONTRIBUTOR'))
    or (select count(*) from jsonb_to_recordset(assignments) as a(member_id uuid,role text)) <>
       (select count(distinct a.member_id) from jsonb_to_recordset(assignments) as a(member_id uuid,role text)) then
     raise exception 'At least one lead and unique members are required' using errcode='22023'; end if;
   if exists (select 1 from jsonb_to_recordset(assignments) as a(member_id uuid,role text) left join public.members m on m.id=a.member_id
      where m.id is null or (not m.active and not exists (select 1 from public.task_members tm where tm.task_id=target_id and tm.member_id=a.member_id))) then
     raise exception 'Task member missing or archived' using errcode='22023'; end if;
   -- Closing is stricter than editing: creator status alone cannot close a team task.
   if candidate.status='DONE' and (target_id is null or previous.status<>'DONE')
    and not public.has_app_permission('tasks.manage_all')
    and not exists (select 1 from public.task_members tm where tm.task_id=target_id and tm.member_id=actor_member and tm.role='LEAD')
    and not (target_id is null and exists (select 1 from jsonb_to_recordset(assignments) as a(member_id uuid,role text) where a.member_id=actor_member and a.role='LEAD')) then
     raise exception 'Only a lead or global manager can complete a team task' using errcode='42501'; end if;
 end if;
 -- Validate new/changed links. Historical links survive cancellations and future series edits.
 if candidate.event_id is not null and (target_id is null or candidate.event_id is distinct from previous.event_id
      or candidate.event_occurrence_date is distinct from previous.event_occurrence_date) then
   if not public.has_app_permission('events.read') then raise exception 'Agenda permission denied' using errcode='42501'; end if;
   select * into linked from public.events where id=candidate.event_id for share;
   if not found then raise exception 'Event not found' using errcode='22023'; end if;
   if candidate.event_occurrence_date is not null and (linked.frequency='NONE' or not public.agenda_is_occurrence(linked,candidate.event_occurrence_date)) then
     raise exception 'Invalid event occurrence' using errcode='22023'; end if;
 end if;
 if target_id is null then
   insert into public.tasks(scope,owner_member_id,owner_user_id,title,description,status,priority,deadline_date,deadline_at,timezone,event_id,event_occurrence_date,created_by,updated_by)
   values(candidate.scope,case when candidate.scope='PERSONAL' then actor_member end,case when candidate.scope='PERSONAL' then auth.uid() end,
    candidate.title,candidate.description,candidate.status,candidate.priority,candidate.deadline_date,candidate.deadline_at,candidate.timezone,
    candidate.event_id,candidate.event_occurrence_date,auth.uid(),auth.uid()) returning * into saved;
   insert into public.task_activity(task_id,actor_id,action) values(saved.id,auth.uid(),'TASK_CREATED');
 else
   update public.tasks set title=candidate.title,description=candidate.description,status=candidate.status,priority=candidate.priority,
    deadline_date=candidate.deadline_date,deadline_at=candidate.deadline_at,timezone=candidate.timezone,event_id=candidate.event_id,event_occurrence_date=candidate.event_occurrence_date,
    revision=revision+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=target_id returning * into saved;
   select coalesce(jsonb_agg(x.key),'[]') into changed_fields from jsonb_each(to_jsonb(saved)) x
    where x.key in ('title','description','priority','deadline_date','deadline_at','event_id','event_occurrence_date')
    and x.value is distinct from to_jsonb(previous)->x.key;
   if jsonb_array_length(changed_fields)>0 then insert into public.task_activity(task_id,actor_id,action,metadata)
     values(saved.id,auth.uid(),'TASK_UPDATED',jsonb_build_object('fields',changed_fields)); end if;
   if previous.status<>saved.status then insert into public.task_activity(task_id,actor_id,action,metadata)
     values(saved.id,auth.uid(),case when saved.status='CANCELLED' then 'TASK_CANCELLED' else 'STATUS_CHANGED' end,
       jsonb_build_object('before',previous.status,'after',saved.status)); end if;
 end if;
 -- Record membership changes before targeted insert/update/delete; preserve work_status on promotion.
 for current_assignment in select tm.member_id,tm.role old_role,a.role new_role from public.task_members tm
   left join jsonb_to_recordset(assignments) as a(member_id uuid,role text) on a.member_id=tm.member_id where tm.task_id=saved.id loop
   if current_assignment.new_role is null or current_assignment.new_role<>current_assignment.old_role then
     insert into public.task_activity(task_id,actor_id,action,metadata) values(saved.id,auth.uid(),
      case when current_assignment.new_role is null then 'MEMBER_REMOVED' else 'MEMBER_ROLE_CHANGED' end,
      jsonb_build_object('member_id',current_assignment.member_id,'before',current_assignment.old_role,'after',current_assignment.new_role));
   end if;
 end loop;
 insert into public.task_activity(task_id,actor_id,action,metadata)
   select saved.id,auth.uid(),'MEMBER_ADDED',jsonb_build_object('member_id',a.member_id,'after',a.role)
   from jsonb_to_recordset(assignments) as a(member_id uuid,role text)
   where not exists(select 1 from public.task_members tm where tm.task_id=saved.id and tm.member_id=a.member_id);
 delete from public.task_members tm where tm.task_id=saved.id and not exists
   (select 1 from jsonb_to_recordset(assignments) as a(member_id uuid,role text) where a.member_id=tm.member_id);
 insert into public.task_members(task_id,member_id,role)
   select saved.id,a.member_id,a.role from jsonb_to_recordset(assignments) as a(member_id uuid,role text)
   on conflict(task_id,member_id) do update set role=excluded.role,updated_at=clock_timestamp() where task_members.role<>excluded.role;
 -- Only initial default reminder data exists in this phase; keep it aligned with the deadline.
 if target_id is null or previous.deadline_date is distinct from saved.deadline_date or previous.deadline_at is distinct from saved.deadline_at then
   delete from public.task_reminders where task_id=saved.id;
   if saved.deadline_date is not null then insert into public.task_reminders(task_id,kind,days_before,local_time) values(saved.id,'LOCAL_TIME',1,'19:00');
   elsif saved.deadline_at is not null then insert into public.task_reminders(task_id,kind,offset_minutes) values(saved.id,'OFFSET',1440); end if;
 end if;
 return saved.id;
end;
$$;

create function public.set_my_task_work_status(target_id uuid, expected_revision bigint, new_status text)
returns void language plpgsql security definer set search_path='' as $$
declare parent public.tasks; own public.task_members; actor_member uuid:=public.task_current_member_id();
begin
 if not public.can_read_task(target_id) then raise exception 'Task permission denied' using errcode='42501'; end if;
 select * into parent from public.tasks where id=target_id for update;
 select * into own from public.task_members tm where tm.task_id=target_id and tm.member_id=actor_member;
 if not public.can_read_task(target_id) or not found or parent.scope<>'TEAM' then raise exception 'Task permission denied' using errcode='42501'; end if;
 if parent.revision is distinct from expected_revision then raise exception 'Task changed; reload' using errcode='40001'; end if;
 if new_status is null or new_status not in ('TODO','DONE') or parent.status='CANCELLED' then raise exception 'Invalid work status' using errcode='22023'; end if;
 if own.work_status=new_status then return; end if;
 update public.task_members tm set work_status=new_status,updated_at=clock_timestamp() where tm.task_id=target_id and tm.member_id=actor_member;
 update public.tasks set revision=revision+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=target_id;
 insert into public.task_activity(task_id,actor_id,action,metadata) values(target_id,auth.uid(),
  case when new_status='DONE' then 'MEMBER_WORK_COMPLETED' else 'MEMBER_WORK_REOPENED' end,
  jsonb_build_object('member_id',actor_member,'before',own.work_status,'after',new_status));
end;
$$;

revoke all on function public.task_current_member_id(),public.can_read_task(uuid),public.can_manage_task(uuid),
 public.save_task(uuid,bigint,jsonb,jsonb),public.set_my_task_work_status(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.can_read_task(uuid),public.can_manage_task(uuid),
 public.save_task(uuid,bigint,jsonb,jsonb),public.set_my_task_work_status(uuid,bigint,text) to authenticated;
commit;
