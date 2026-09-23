-- Notifications: owner-only inbox/settings; service-only planning and delivery.
begin;
create table public.notification_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 push_enabled boolean not null default false,
 event_notifications_enabled boolean not null default true,
 task_notifications_enabled boolean not null default true,
 push_details boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.notification_category_preferences (
 user_id uuid not null references auth.users(id) on delete cascade,
 category_key text not null references public.event_categories(key) on delete cascade,
 enabled boolean not null default true, primary key(user_id,category_key)
);
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique check(char_length(endpoint)<=2048),
 p256dh text not null check(char_length(p256dh) between 80 and 100), auth text not null check(char_length(auth) between 20 and 30),
 device_label text not null default 'Cet appareil' check(char_length(device_label) between 1 and 80),
 active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_seen_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions(user_id,active);
create table public.notification_rebuild_queue (
 source_type text not null check(source_type in ('EVENT','TASK')), source_id uuid not null,
 revision bigint not null default 1, next_plan_at timestamptz not null default now(),
 claimed_at timestamptz, claim_token uuid, last_error_code text,
 primary key(source_type,source_id)
);
create table public.notification_jobs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 source_type text not null check(source_type in ('EVENT','TASK','SYSTEM')), source_id uuid not null,
 source_occurrence_key text not null default '', reminder_id uuid not null, source_revision bigint not null,
 due_at timestamptz not null, expires_at timestamptz not null,
 title text not null check(char_length(title)<=250), body text not null check(char_length(body)<=1000),
 status text not null default 'PENDING' check(status in ('PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED')),
 attempt_count integer not null default 0, next_attempt_at timestamptz not null default now(), last_error_code text,
 created_at timestamptz not null default now(), claimed_at timestamptz, completed_at timestamptz,
 test_subscription_id uuid references public.push_subscriptions(id) on delete set null,
 unique(user_id,source_type,source_id,source_occurrence_key,reminder_id,due_at)
);
create index notification_jobs_due on public.notification_jobs(status,due_at,next_attempt_at);
create index notification_jobs_source on public.notification_jobs(source_type,source_id);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 job_id uuid unique references public.notification_jobs(id) on delete set null,
 kind text not null check(kind in ('EVENT_REMINDER','TASK_REMINDER','SYSTEM')),
 title text not null, body text not null, source_type text not null, source_id uuid not null, source_occurrence_key text not null default '',
 created_at timestamptz not null default now(), read_at timestamptz
);
create index notifications_user_date on public.notifications(user_id,created_at desc,id);
create index notifications_unread on public.notifications(user_id) where read_at is null;
create table public.notification_deliveries (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.notification_jobs(id) on delete cascade,
 subscription_id uuid references public.push_subscriptions(id) on delete set null,
 status text not null default 'PENDING' check(status in ('PENDING','PROCESSING','SENT','FAILED','CANCELLED')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(), claimed_at timestamptz, claim_token uuid,
 last_error_code text, sent_at timestamptz, unique(job_id,subscription_id)
);
create index notification_deliveries_due on public.notification_deliveries(status,next_attempt_at);
alter table public.notification_preferences enable row level security;
alter table public.notification_category_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_jobs enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_rebuild_queue enable row level security;
revoke all on public.notification_preferences,public.notification_category_preferences,public.push_subscriptions,public.notifications,
 public.notification_jobs,public.notification_deliveries,public.notification_rebuild_queue from public,anon,authenticated;
grant select on public.notification_preferences,public.notification_category_preferences,public.push_subscriptions,public.notifications to authenticated;
create policy notification_preferences_own on public.notification_preferences for select to authenticated using(user_id=auth.uid() and public.has_app_access());
create policy notification_category_own on public.notification_category_preferences for select to authenticated using(user_id=auth.uid() and public.has_app_access());
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated using(user_id=auth.uid() and public.has_app_access());
create policy notifications_own on public.notifications for select to authenticated using(user_id=auth.uid() and public.has_app_access());

create function public.notification_user_permission(target_user uuid, permission text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.app_user_roles ur join public.app_role_permissions rp on rp.role_key=ur.role_key where ur.user_id=target_user and rp.permission_key=permission);
$$;
create function public.notification_recipient_allowed(kind text, source uuid, target_user uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare person public.members; pref public.notification_preferences; e public.events; t public.tasks;
begin
 if not public.notification_user_permission(target_user,'app.access') then return false; end if;
 if kind='SYSTEM' then return true; end if;
 select * into person from public.members where user_id=target_user and active;
 if not found then return false; end if;
 select * into pref from public.notification_preferences where user_id=target_user;
 if kind='EVENT' then
  if not coalesce(pref.event_notifications_enabled,true) or not public.notification_user_permission(target_user,'events.read') then return false; end if;
  select * into e from public.events where id=source and status='SCHEDULED';
  if not found then return false; end if;
  return e.audience_type='ALL' or exists(select 1 from public.event_participants p where p.event_id=e.id and p.member_id=person.id);
 elsif kind='TASK' then
  if not coalesce(pref.task_notifications_enabled,true) then return false; end if;
  select * into t from public.tasks where id=source and status not in ('DONE','CANCELLED') and (deadline_date is not null or deadline_at is not null);
  if not found then return false; end if;
  return (t.scope='PERSONAL' and t.owner_member_id=person.id and t.owner_user_id=target_user)
    or (t.scope='TEAM' and exists(select 1 from public.task_members tm where tm.task_id=t.id and tm.member_id=person.id and tm.work_status='TODO'));
 end if;
 return false;
end $$;

create function public.notification_dirty(kind text, source uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.notification_rebuild_queue(source_type,source_id) values(kind,source)
 on conflict(source_type,source_id) do update set revision=notification_rebuild_queue.revision+1,next_plan_at=now();
 update public.notification_jobs set status='CANCELLED' where source_type=kind and source_id=source and status in ('PENDING','PROCESSING');
 update public.notification_deliveries d set status='CANCELLED',claim_token=null where d.status in ('PENDING','PROCESSING')
  and exists(select 1 from public.notification_jobs j where j.id=d.job_id and j.source_type=kind and j.source_id=source);
end $$;
create function public.notification_source_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb;
begin
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 perform public.notification_dirty(tg_argv[0],(row_data->>tg_argv[1])::uuid);
 return null;
end $$;
create trigger notifications_event_changed after insert or update or delete on public.events for each row execute function public.notification_source_changed('EVENT','id');
create trigger notifications_event_participants after insert or update or delete on public.event_participants for each row execute function public.notification_source_changed('EVENT','event_id');
create trigger notifications_event_overrides after insert or update or delete on public.event_occurrence_overrides for each row execute function public.notification_source_changed('EVENT','event_id');
create trigger notifications_event_reminders after insert or update or delete on public.event_reminders for each row execute function public.notification_source_changed('EVENT','event_id');
create trigger notifications_task_changed after insert or update or delete on public.tasks for each row execute function public.notification_source_changed('TASK','id');
create trigger notifications_task_members after insert or update or delete on public.task_members for each row execute function public.notification_source_changed('TASK','task_id');
create trigger notifications_task_reminders after insert or update or delete on public.task_reminders for each row execute function public.notification_source_changed('TASK','task_id');

-- A user's opt-out must not discard another recipient's already queued device retries.
create function public.notification_dirty_user(kind text,source uuid,users uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare version bigint;
begin
 insert into public.notification_rebuild_queue(source_type,source_id) values(kind,source)
 on conflict(source_type,source_id) do update set revision=notification_rebuild_queue.revision+1,next_plan_at=now()
 returning revision into version;
 update public.notification_jobs set source_revision=version where source_type=kind and source_id=source and not(user_id=any(array_remove(users,null)));
 update public.notification_jobs set status='CANCELLED' where source_type=kind and source_id=source and user_id=any(users) and status in ('PENDING','PROCESSING');
 update public.notification_deliveries d set status='CANCELLED',claim_token=null where d.status in ('PENDING','PROCESSING')
  and exists(select 1 from public.notification_jobs j where j.id=d.job_id and j.source_type=kind and j.source_id=source and j.user_id=any(users));
end $$;
create function public.notification_user_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare person uuid; row_data jsonb; old_data jsonb; target_user uuid; old_user uuid; source record;
begin
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_op='UPDATE' then old_data:=to_jsonb(old); end if;
 if tg_table_name='members' then
  -- Editing a name does not require cancelling pending reminders.
  if tg_op='UPDATE' and row_data->'active'=old_data->'active' and row_data->'user_id' is not distinct from old_data->'user_id' then return null; end if;
  person:=(row_data->>'id')::uuid;
 end if;
 target_user:=(row_data->>'user_id')::uuid; old_user:=(old_data->>'user_id')::uuid;
 if person is null then select id into person from public.members where user_id=target_user; end if;
 -- User changes affect this person's tasks and the Agenda audience; no browser dependency.
 for source in select 'EVENT' kind,e.id from public.events e where e.status='SCHEDULED'
  union select 'TASK',t.id from public.tasks t where t.owner_member_id=person or t.owner_user_id in (target_user,old_user)
   or exists(select 1 from public.task_members tm where tm.task_id=t.id and tm.member_id=person)
 loop perform public.notification_dirty_user(source.kind,source.id,array[target_user,old_user]); end loop;
 return null;
end $$;
create trigger notifications_member_changed after insert or update or delete on public.members for each row execute function public.notification_user_changed();
create trigger notifications_roles_changed after insert or update or delete on public.app_user_roles for each row execute function public.notification_user_changed();
create trigger notifications_preferences_changed after insert or update or delete on public.notification_preferences for each row execute function public.notification_user_changed();
create trigger notifications_categories_changed after insert or update or delete on public.notification_category_preferences for each row execute function public.notification_user_changed();
create function public.notification_role_permissions_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare source record;
begin
 for source in select source_type,source_id from public.notification_rebuild_queue loop perform public.notification_dirty(source.source_type,source.source_id); end loop;
 return null;
end $$;
create trigger notifications_permission_matrix_changed after insert or update or delete on public.app_role_permissions for each statement execute function public.notification_role_permissions_changed();
insert into public.notification_rebuild_queue(source_type,source_id) select 'EVENT',id from public.events union all select 'TASK',id from public.tasks;

create function public.save_notification_preferences(details jsonb, categories jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_app_access() then raise exception 'Notification permission denied' using errcode='42501'; end if;
 if jsonb_typeof(details) is distinct from 'object' or jsonb_typeof(categories) is distinct from 'array' or jsonb_array_length(categories)>100 then raise exception 'Invalid preferences' using errcode='22023'; end if;
 insert into public.notification_preferences(user_id,push_enabled,event_notifications_enabled,task_notifications_enabled,push_details)
 values(auth.uid(),(details->>'push_enabled')::boolean,(details->>'event_notifications_enabled')::boolean,(details->>'task_notifications_enabled')::boolean,coalesce((details->>'push_details')::boolean,false))
 on conflict(user_id) do update set push_enabled=excluded.push_enabled,event_notifications_enabled=excluded.event_notifications_enabled,
 task_notifications_enabled=excluded.task_notifications_enabled,push_details=excluded.push_details,updated_at=now();
 delete from public.notification_category_preferences where user_id=auth.uid();
 insert into public.notification_category_preferences(user_id,category_key,enabled)
 select auth.uid(),p.category_key,p.enabled from jsonb_to_recordset(categories) as p(category_key text,enabled boolean);
end $$;
create function public.mark_notifications_read(target_id uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_app_access() then raise exception 'Notification permission denied' using errcode='42501'; end if;
 update public.notifications set read_at=coalesce(read_at,now()) where user_id=auth.uid() and (target_id is null or id=target_id);
end $$;
create function public.register_push_subscription(details jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare saved uuid; endpoint_value text:=details->>'endpoint';
begin
 if not public.has_app_access() then raise exception 'Notification permission denied' using errcode='42501'; end if;
 -- Prevent SSRF through arbitrary user-provided delivery destinations. Standard browser services only.
 if endpoint_value is null or endpoint_value !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/[^[:space:]#]+$'
  or coalesce(details->>'p256dh','') !~ '^[A-Za-z0-9_-]{87}=?$' or coalesce(details->>'auth','') !~ '^[A-Za-z0-9_-]{22}(==)?$' then raise exception 'Invalid push subscription' using errcode='22023'; end if;
 if exists(select 1 from public.push_subscriptions where endpoint=endpoint_value and user_id<>auth.uid()) then raise exception 'Renew this browser subscription' using errcode='42501'; end if;
 if (select count(*) from public.push_subscriptions where user_id=auth.uid() and active)>=20
  and not exists(select 1 from public.push_subscriptions where endpoint=endpoint_value and user_id=auth.uid() and active) then raise exception 'Device limit reached' using errcode='22023'; end if;
 insert into public.push_subscriptions(user_id,endpoint,p256dh,auth,device_label)
 values(auth.uid(),endpoint_value,details->>'p256dh',details->>'auth',coalesce(nullif(btrim(details->>'device_label'),''),'Cet appareil'))
 on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,device_label=excluded.device_label,active=true,updated_at=now(),last_seen_at=now()
 where push_subscriptions.user_id=auth.uid() returning id into saved;
 if saved is null then raise exception 'Notification permission denied' using errcode='42501'; end if;
 return saved;
end $$;
create function public.disable_push_subscription(target_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_app_access() then raise exception 'Notification permission denied' using errcode='42501'; end if;
 update public.push_subscriptions set active=false,updated_at=now() where id=target_id and user_id=auth.uid();
 update public.notification_deliveries d set status='CANCELLED',claim_token=null where subscription_id=target_id and status in ('PENDING','PROCESSING')
  and exists(select 1 from public.push_subscriptions s where s.id=target_id and s.user_id=auth.uid());
end $$;
create function public.touch_push_subscription(endpoint_value text) returns uuid language plpgsql security definer set search_path='' as $$
declare saved uuid;
begin
 if not public.has_app_access() then raise exception 'Notification permission denied' using errcode='42501'; end if;
 update public.push_subscriptions set last_seen_at=now() where user_id=auth.uid() and endpoint=endpoint_value and active returning id into saved;
 return saved;
end $$;

-- Reminder definitions are edited atomically with the existing domain RPC, retaining IDs.
create function public.notification_replace_reminders(kind text, source uuid, definitions jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r record;
begin
 if jsonb_typeof(definitions) is distinct from 'array' or jsonb_array_length(definitions)>10 then raise exception 'Maximum ten reminders' using errcode='22023'; end if;
 if exists(select 1 from jsonb_to_recordset(definitions) as d(id uuid) where d.id is not null group by d.id having count(*)>1) then raise exception 'Duplicate reminder' using errcode='22023'; end if;
 if exists(select 1 from jsonb_to_recordset(definitions) as d(kind text,offset_minutes integer,days_before integer,local_time time,scheduled_at timestamptz)
  group by d.kind,d.offset_minutes,d.days_before,d.local_time,d.scheduled_at having count(*)>1) then raise exception 'Duplicate reminder' using errcode='22023'; end if;
 if kind='EVENT' and exists(select 1 from public.events where id=source and frequency<>'NONE')
  and exists(select 1 from jsonb_array_elements(definitions) d where d->>'kind'='ABSOLUTE') then raise exception 'Use relative reminders for a series' using errcode='22023'; end if;
 if kind='TASK' and jsonb_array_length(definitions)>0 and exists(select 1 from public.tasks where id=source and deadline_date is null and deadline_at is null) then raise exception 'Task deadline required' using errcode='22023'; end if;
 if kind='EVENT' then
  if exists(select 1 from public.event_reminders er join jsonb_to_recordset(definitions) as d(id uuid) on d.id=er.id where er.event_id<>source) then raise exception 'Invalid reminder' using errcode='22023'; end if;
  delete from public.event_reminders where event_id=source;
 else
  if exists(select 1 from public.task_reminders tr join jsonb_to_recordset(definitions) as d(id uuid) on d.id=tr.id where tr.task_id<>source) then raise exception 'Invalid reminder' using errcode='22023'; end if;
  delete from public.task_reminders where task_id=source;
 end if;
 for r in select * from jsonb_to_recordset(definitions) as d(id uuid,kind text,offset_minutes integer,days_before integer,local_time time,scheduled_at timestamptz) loop
  if kind='EVENT' then
   insert into public.event_reminders(id,event_id,kind,offset_minutes,days_before,local_time,scheduled_at)
   values(coalesce(r.id,gen_random_uuid()),source,r.kind,r.offset_minutes,r.days_before,r.local_time,r.scheduled_at);
  else
   insert into public.task_reminders(id,task_id,kind,offset_minutes,days_before,local_time,scheduled_at)
   values(coalesce(r.id,gen_random_uuid()),source,r.kind,r.offset_minutes,r.days_before,r.local_time,r.scheduled_at);
  end if;
 end loop;
end $$;
create function public.save_agenda_event_with_reminders(target_id uuid,expected_revision bigint,details jsonb,participant_ids uuid[],reminders jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare saved uuid;
begin
 saved:=public.save_agenda_event(target_id,expected_revision,details,participant_ids);
 if reminders is not null then perform public.notification_replace_reminders('EVENT',saved,reminders); end if;
 return saved;
end $$;
create function public.save_task_with_reminders(target_id uuid,expected_revision bigint,details jsonb,assignments jsonb,reminders jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare saved uuid;
begin
 saved:=public.save_task(target_id,expected_revision,details,assignments);
 if reminders is not null then perform public.notification_replace_reminders('TASK',saved,reminders); end if;
 return saved;
end $$;

-- Server-only planner leases. Dirty revision changes invalidate the lease's plan at commit.
create function public.claim_notification_sources(batch_size integer default 5) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 with chosen as (select q.source_type,q.source_id from public.notification_rebuild_queue q where q.next_plan_at<=now()
  and (q.claimed_at is null or q.claimed_at<now()-interval '2 minutes') order by q.next_plan_at,q.source_id for update skip locked limit least(greatest(batch_size,1),20)),
 claimed as (update public.notification_rebuild_queue q set claimed_at=now(),claim_token=gen_random_uuid()
  from chosen c where q.source_type=c.source_type and q.source_id=c.source_id returning q.*)
 select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object(
  'source',case when c.source_type='EVENT' then (select to_jsonb(e) from public.events e where e.id=c.source_id) else (select to_jsonb(t) from public.tasks t where t.id=c.source_id) end,
  'reminders',case when c.source_type='EVENT' then coalesce((select jsonb_agg(to_jsonb(r)) from public.event_reminders r where r.event_id=c.source_id),'[]') else coalesce((select jsonb_agg(to_jsonb(r)) from public.task_reminders r where r.task_id=c.source_id),'[]') end,
  'overrides',case when c.source_type='EVENT' then coalesce((select jsonb_agg(to_jsonb(o)) from public.event_occurrence_overrides o where o.event_id=c.source_id),'[]') else '[]'::jsonb end,
  'recipients',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'disabled_categories',coalesce((select jsonb_agg(p.category_key) from public.notification_category_preferences p where p.user_id=m.user_id and not p.enabled),'[]'::jsonb))) from public.members m where m.active and m.user_id is not null and public.notification_recipient_allowed(c.source_type,c.source_id,m.user_id)),'[]')
 )),'[]') into result from claimed c;
 return result;
end $$;
create function public.commit_notification_plan(kind text,source uuid,expected_revision bigint,token uuid,planned jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare q public.notification_rebuild_queue; p record;
begin
 select * into q from public.notification_rebuild_queue where source_type=kind and source_id=source for update;
 if not found or q.revision<>expected_revision or q.claim_token is distinct from token then return false; end if;
 if jsonb_typeof(planned) is distinct from 'array' or jsonb_array_length(planned)>20000 then raise exception 'Plan too large' using errcode='22023'; end if;
 -- Reconciliation also cancels jobs removed from a recurring window or preference change.
 update public.notification_jobs set status='CANCELLED' where source_type=kind and source_id=source and status='PENDING';
 for p in select * from jsonb_to_recordset(planned) as d(user_id uuid,occurrence_key text,reminder_id uuid,due_at timestamptz,expires_at timestamptz,title text,body text) loop
  if p.due_at<now()-interval '24 hours' or p.due_at>now()+interval '91 days' or p.expires_at<=now()
    or not public.notification_recipient_allowed(kind,source,p.user_id) then continue; end if;
  insert into public.notification_jobs(user_id,source_type,source_id,source_occurrence_key,reminder_id,source_revision,due_at,expires_at,title,body)
   values(p.user_id,kind,source,coalesce(p.occurrence_key,''),p.reminder_id,expected_revision,p.due_at,p.expires_at,p.title,p.body)
  on conflict(user_id,source_type,source_id,source_occurrence_key,reminder_id,due_at) do update set status='PENDING',source_revision=excluded.source_revision,
    expires_at=excluded.expires_at,title=excluded.title,body=excluded.body,next_attempt_at=now()
    where notification_jobs.status in ('PENDING','CANCELLED') and not exists(select 1 from public.notifications n where n.job_id=notification_jobs.id);
 end loop;
 update public.notification_rebuild_queue set next_plan_at=now()+interval '6 hours',claimed_at=null,claim_token=null,last_error_code=null where source_type=kind and source_id=source;
 return true;
end $$;
create function public.fail_notification_plan(kind text,source uuid,token uuid) returns void language plpgsql security definer set search_path='' as $$
begin update public.notification_rebuild_queue set claimed_at=null,claim_token=null,next_plan_at=now()+interval '1 minute',last_error_code='PLAN_FAILED'
 where source_type=kind and source_id=source and claim_token=token; end $$;

create function public.notification_job_allowed(job public.notification_jobs) returns boolean language sql stable security definer set search_path='' as $$
 select job.expires_at>now() and public.notification_recipient_allowed(job.source_type,job.source_id,job.user_id)
 and (job.source_type<>'EVENT' or not exists(select 1 from public.notification_category_preferences p where p.user_id=job.user_id and not p.enabled
  and p.category_key=coalesce((select o.category from public.event_occurrence_overrides o where o.event_id=job.source_id and o.occurrence_date::text=job.source_occurrence_key),(select e.category from public.events e where e.id=job.source_id))))
 and (job.source_type='SYSTEM' or exists(select 1 from public.notification_rebuild_queue q where q.source_type=job.source_type and q.source_id=job.source_id and q.revision=job.source_revision));
$$;
create function public.materialize_notification_jobs(batch_size integer default 30) returns integer language plpgsql security definer set search_path='' as $$
declare job public.notification_jobs; total integer:=0;
begin
 for job in select * from public.notification_jobs where status='PENDING' and due_at<=now() and next_attempt_at<=now()
  order by due_at,id for update skip locked limit least(greatest(batch_size,1),50) loop
  if not public.notification_job_allowed(job) or job.due_at<now()-interval '24 hours' then
   update public.notification_jobs set status='CANCELLED' where id=job.id; continue;
  end if;
  update public.notification_jobs set status='PROCESSING',claimed_at=now(),attempt_count=attempt_count+1 where id=job.id;
  insert into public.notifications(user_id,job_id,kind,title,body,source_type,source_id,source_occurrence_key)
   values(job.user_id,job.id,case job.source_type when 'EVENT' then 'EVENT_REMINDER' when 'TASK' then 'TASK_REMINDER' else 'SYSTEM' end,job.title,job.body,job.source_type,job.source_id,job.source_occurrence_key)
   on conflict(job_id) do nothing;
  insert into public.notification_deliveries(job_id,subscription_id)
   select job.id,s.id from public.push_subscriptions s where s.user_id=job.user_id and s.active
    and (job.source_type<>'SYSTEM' or s.id=job.test_subscription_id)
    and exists(select 1 from public.notification_preferences p where p.user_id=job.user_id and p.push_enabled)
   on conflict(job_id,subscription_id) do nothing;
  update public.notification_jobs set status='COMPLETED',completed_at=now() where id=job.id;
  total:=total+1;
 end loop;
 return total;
end $$;
create function public.claim_notification_deliveries(batch_size integer default 10) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.notification_deliveries; j public.notification_jobs; s public.push_subscriptions; n public.notifications; result jsonb:='[]'; details boolean;
begin
 for d in select * from public.notification_deliveries where
  (status='PENDING' and next_attempt_at<=now()) or (status='PROCESSING' and claimed_at<now()-interval '90 seconds')
  order by next_attempt_at,id for update skip locked limit least(greatest(batch_size,1),20) loop
  select * into j from public.notification_jobs where id=d.job_id;
  select * into s from public.push_subscriptions where id=d.subscription_id;
  if not public.notification_job_allowed(j) or not coalesce(s.active,false) or s.user_id is distinct from j.user_id
   or not exists(select 1 from public.notification_preferences p where p.user_id=j.user_id and p.push_enabled) then
   update public.notification_deliveries set status='CANCELLED',claim_token=null where id=d.id; continue;
  end if;
  if d.attempts>=4 then update public.notification_deliveries set status='FAILED',last_error_code='RETRY_LIMIT',claim_token=null where id=d.id; continue; end if;
  select * into n from public.notifications where job_id=j.id;
  select push_details into details from public.notification_preferences where user_id=j.user_id;
  update public.notification_deliveries set status='PROCESSING',attempts=attempts+1,claimed_at=now(),claim_token=gen_random_uuid() where id=d.id returning * into d;
  result:=result||jsonb_build_array(jsonb_build_object('id',d.id,'token',d.claim_token,'subscription_id',s.id,
   'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth)),
   'payload',jsonb_build_object('notificationId',n.id,'deliveryId',d.id,'title',case when details then n.title else 'Chiro Negenmanneke' end,
   'body',case when details then n.body else 'Un rappel vous attend dans l’application.' end)));
 end loop;
 return result;
end $$;
create function public.authorize_notification_delivery(target_id uuid,token uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.notification_deliveries d join public.notification_jobs j on j.id=d.job_id
  join public.push_subscriptions s on s.id=d.subscription_id join public.notification_preferences p on p.user_id=j.user_id
  where d.id=target_id and d.claim_token=token and d.status='PROCESSING' and s.active and s.user_id=j.user_id and p.push_enabled and public.notification_job_allowed(j));
$$;
create function public.finish_notification_delivery(target_id uuid,token uuid,result_code text) returns void language plpgsql security definer set search_path='' as $$
declare d public.notification_deliveries;
begin
 select * into d from public.notification_deliveries where id=target_id and claim_token=token and status='PROCESSING' for update;
 if not found then return; end if;
 if result_code='CANCELLED' then update public.notification_deliveries set status='CANCELLED',claim_token=null where id=d.id;
 elsif result_code='OK' then update public.notification_deliveries set status='SENT',sent_at=now(),claim_token=null,last_error_code=null where id=d.id;
 elsif result_code in ('404','410') then
  update public.push_subscriptions set active=false,updated_at=now() where id=d.subscription_id;
  update public.notification_deliveries set status='FAILED',last_error_code=result_code,claim_token=null where id=d.id;
 elsif result_code in ('TEMPORARY','429','500','502','503','504') and d.attempts<4 then
  update public.notification_deliveries set status='PENDING',next_attempt_at=now()+case d.attempts when 1 then interval '1 minute' when 2 then interval '5 minutes' else interval '15 minutes' end,
   last_error_code=result_code,claim_token=null where id=d.id;
 else update public.notification_deliveries set status='FAILED',last_error_code=case when result_code in ('400','401','403','CONFIG') then result_code else 'PERMANENT' end,claim_token=null where id=d.id;
 end if;
end $$;
create function public.enqueue_my_notification_test(subscription_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare saved uuid;
begin
 if not public.has_app_access() or not exists(select 1 from public.push_subscriptions s where s.id=subscription_id and s.user_id=auth.uid() and s.active)
  or not exists(select 1 from public.notification_preferences p where p.user_id=auth.uid() and p.push_enabled) then raise exception 'Notification permission denied' using errcode='42501'; end if;
 -- Serialize per user and rate-limit tests to one per minute.
 perform 1 from public.notification_preferences where user_id=auth.uid() for update;
 if exists(select 1 from public.notification_jobs where user_id=auth.uid() and source_type='SYSTEM' and created_at>now()-interval '1 minute') then raise exception 'Wait one minute before testing again' using errcode='22023'; end if;
 insert into public.notification_jobs(user_id,source_type,source_id,reminder_id,source_revision,due_at,expires_at,title,body,test_subscription_id)
 values(auth.uid(),'SYSTEM',auth.uid(),'00000000-0000-0000-0000-000000000000',0,now(),now()+interval '10 minutes','Notification de test','Les notifications Chiro sont prêtes.',subscription_id) returning id into saved;
 return saved;
end $$;
create function public.cleanup_notifications() returns void language plpgsql security definer set search_path='' as $$
begin
 delete from public.notifications where id in(select id from public.notifications where read_at<now()-interval '365 days' order by read_at limit 200);
 delete from public.notification_jobs where id in(select id from public.notification_jobs where created_at<now()-interval '180 days' and status in ('COMPLETED','CANCELLED','FAILED') order by created_at limit 200);
 delete from public.push_subscriptions where id in(select id from public.push_subscriptions where not active and updated_at<now()-interval '90 days' order by updated_at limit 50);
end $$;

-- Explicit allowlists of exposed entrypoints. System helpers and queues are never client APIs.
revoke all on function public.notification_user_permission(uuid,text),public.notification_recipient_allowed(text,uuid,uuid),public.notification_dirty(text,uuid),
 public.notification_dirty_user(text,uuid,uuid[]),
 public.notification_source_changed(),public.notification_user_changed(),public.notification_role_permissions_changed(),public.notification_replace_reminders(text,uuid,jsonb),public.notification_job_allowed(public.notification_jobs),
 public.save_notification_preferences(jsonb,jsonb),public.mark_notifications_read(uuid),public.register_push_subscription(jsonb),public.disable_push_subscription(uuid),public.touch_push_subscription(text),
 public.save_agenda_event_with_reminders(uuid,bigint,jsonb,uuid[],jsonb),public.save_task_with_reminders(uuid,bigint,jsonb,jsonb,jsonb),public.enqueue_my_notification_test(uuid),
 public.claim_notification_sources(integer),public.commit_notification_plan(text,uuid,bigint,uuid,jsonb),public.fail_notification_plan(text,uuid,uuid),public.materialize_notification_jobs(integer),
 public.claim_notification_deliveries(integer),public.authorize_notification_delivery(uuid,uuid),public.finish_notification_delivery(uuid,uuid,text),public.cleanup_notifications() from public,anon,authenticated;
grant execute on function public.save_notification_preferences(jsonb,jsonb),public.mark_notifications_read(uuid),public.register_push_subscription(jsonb),public.disable_push_subscription(uuid),public.touch_push_subscription(text),
 public.save_agenda_event_with_reminders(uuid,bigint,jsonb,uuid[],jsonb),public.save_task_with_reminders(uuid,bigint,jsonb,jsonb,jsonb),public.enqueue_my_notification_test(uuid) to authenticated;
grant execute on function public.claim_notification_sources(integer),public.commit_notification_plan(text,uuid,bigint,uuid,jsonb),public.fail_notification_plan(text,uuid,uuid),public.materialize_notification_jobs(integer),
 public.claim_notification_deliveries(integer),public.authorize_notification_delivery(uuid,uuid),public.finish_notification_delivery(uuid,uuid,text),public.cleanup_notifications() to service_role;
commit;
