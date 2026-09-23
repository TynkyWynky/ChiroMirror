-- Phase 2. Additive; requires the Phase 0 and Phase 1 migrations. No remote execution.
begin;

insert into public.app_permissions(key, description) values
  ('events.read', 'Lire l’agenda'), ('events.create', 'Créer un événement'),
  ('events.update', 'Modifier un événement'), ('events.delete', 'Annuler un événement');
insert into public.app_role_permissions(role_key, permission_key)
  select r.key, p.key from public.app_roles r cross join public.app_permissions p
  where p.key in ('events.read', 'events.create', 'events.update', 'events.delete')
    and (r.key in ('APP_ADMIN', 'RESPONSIBLE') or (r.key in ('MEMBER', 'TREASURER') and p.key = 'events.read'));

create table public.event_categories (key text primary key, label text not null);
insert into public.event_categories values
  ('ACTIVITY', 'Activité'), ('MEETING', 'Réunion'), ('EVENT', 'Événement'),
  ('WEEKEND', 'Weekend'), ('CAMP', 'Camp'), ('DEADLINE', 'Échéance'), ('OTHER', 'Autre');

create function public.agenda_valid_timing(all_day boolean, start_date date, end_date date, starts_at timestamptz, ends_at timestamptz, zone text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(zone = 'Europe/Brussels' and (
    (all_day and start_date is not null and end_date is not null and starts_at is null and ends_at is null
      and start_date >= date '2000-01-01' and end_date <= date '2100-12-31' and end_date >= start_date)
    or (not all_day and start_date is null and end_date is null and starts_at is not null and ends_at is not null
      and (starts_at at time zone 'Europe/Brussels')::date >= date '2000-01-01'
      and (ends_at at time zone 'Europe/Brussels')::date <= date '2100-12-31' and ends_at >= starts_at)
  ), false);
$$;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (title = btrim(title) and title ~ '[^[:space:]]' and char_length(title) <= 200),
  description text not null default '' check (char_length(description) <= 10000),
  category text not null references public.event_categories(key),
  location text not null default '' check (char_length(location) <= 300),
  all_day boolean not null,
  start_date date, end_date date, starts_at timestamptz, ends_at timestamptz,
  timezone text not null default 'Europe/Brussels',
  audience_type text not null check (audience_type in ('ALL', 'SELECTED')),
  frequency text not null default 'NONE' check (frequency in ('NONE', 'WEEKLY', 'MONTHLY')),
  recurrence_interval integer not null default 1 check (recurrence_interval between 1 and 52),
  weekdays integer[] not null default '{}',
  until_date date,
  occurrence_count integer check (occurrence_count between 1 and 10000),
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'CANCELLED')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  revision bigint not null default 1,
  check (public.agenda_valid_timing(all_day, start_date, end_date, starts_at, ends_at, timezone)),
  check (until_date is null or (until_date >= coalesce(start_date, (starts_at at time zone 'Europe/Brussels')::date) and until_date <= date '2100-12-31')),
  check ((frequency = 'WEEKLY' and cardinality(weekdays) between 1 and 7 and weekdays <@ array[1,2,3,4,5,6,7]
      and array_position(weekdays, null) is null
      and extract(isodow from coalesce(start_date, (starts_at at time zone 'Europe/Brussels')::date))::integer = any(weekdays))
    or (frequency <> 'WEEKLY' and cardinality(weekdays) = 0)),
  check (frequency <> 'NONE' or (recurrence_interval = 1 and until_date is null and occurrence_count is null))
);
create index events_starts_at_idx on public.events(starts_at) where not all_day;
create index events_start_date_idx on public.events(start_date) where all_day;
create index events_category_status_idx on public.events(category, status);

create table public.event_participants (
  event_id uuid not null references public.events(id) on delete restrict,
  member_id uuid not null references public.members(id) on delete restrict,
  primary key(event_id, member_id)
);
create index event_participants_member_idx on public.event_participants(member_id, event_id);

create table public.event_occurrence_overrides (
  event_id uuid not null references public.events(id) on delete restrict,
  occurrence_date date not null,
  title text not null check (title = btrim(title) and title ~ '[^[:space:]]' and char_length(title) <= 200),
  description text not null default '' check (char_length(description) <= 10000),
  category text not null references public.event_categories(key),
  location text not null default '' check (char_length(location) <= 300),
  all_day boolean not null,
  start_date date, end_date date, starts_at timestamptz, ends_at timestamptz,
  timezone text not null default 'Europe/Brussels',
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'CANCELLED')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(event_id, occurrence_date),
  check (public.agenda_valid_timing(all_day, start_date, end_date, starts_at, ends_at, timezone))
);
create index event_overrides_start_idx on public.event_occurrence_overrides(starts_at, start_date);

-- Data only: no delivery worker, cron, notification queue or push subscription.
create table public.event_reminders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  kind text not null check (kind in ('OFFSET', 'LOCAL_TIME', 'ABSOLUTE')),
  offset_minutes integer check (offset_minutes between 0 and 525600),
  days_before integer check (days_before between 0 and 365),
  local_time time,
  scheduled_at timestamptz,
  timezone text not null default 'Europe/Brussels' check (timezone = 'Europe/Brussels'),
  check ((kind = 'OFFSET' and offset_minutes is not null and days_before is null and local_time is null and scheduled_at is null)
    or (kind = 'LOCAL_TIME' and offset_minutes is null and days_before is not null and local_time is not null and scheduled_at is null)
    or (kind = 'ABSOLUTE' and offset_minutes is null and days_before is null and local_time is null and scheduled_at is not null))
);
create index event_reminders_event_idx on public.event_reminders(event_id);

alter table public.event_categories enable row level security;
alter table public.events enable row level security;
alter table public.event_participants enable row level security;
alter table public.event_occurrence_overrides enable row level security;
alter table public.event_reminders enable row level security;
revoke all on public.event_categories, public.events, public.event_participants, public.event_occurrence_overrides, public.event_reminders from public, anon, authenticated;
grant select on public.event_categories, public.events, public.event_participants, public.event_occurrence_overrides, public.event_reminders to authenticated;
create policy event_categories_read on public.event_categories for select to authenticated using (public.has_app_access() and public.has_app_permission('events.read'));
create policy events_read on public.events for select to authenticated using (public.has_app_access() and public.has_app_permission('events.read'));
create policy event_participants_read on public.event_participants for select to authenticated using (public.has_app_access() and public.has_app_permission('events.read'));
create policy event_overrides_read on public.event_occurrence_overrides for select to authenticated using (public.has_app_access() and public.has_app_permission('events.read'));
create policy event_reminders_read on public.event_reminders for select to authenticated using (public.has_app_access() and public.has_app_permission('events.read'));
-- No direct client DML, even for admins. Targeted RPCs enforce mutation permissions and atomicity.

create function public.agenda_require_permission(permission text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_app_access() or not public.has_app_permission(permission) then
    raise exception 'Agenda permission denied' using errcode = '42501';
  end if;
end;
$$;

create function public.agenda_is_occurrence(e public.events, candidate date)
returns boolean language plpgsql immutable set search_path = '' as $$
declare first_day date := coalesce(e.start_date, (e.starts_at at time zone 'Europe/Brussels')::date);
  monday date; day_value date; month_diff integer; n integer := 0;
begin
  if candidate is null or candidate < first_day or candidate > date '2100-12-31'
    or (e.until_date is not null and candidate > e.until_date) then return false; end if;
  if e.frequency = 'NONE' then return candidate = first_day; end if;
  monday := first_day - (extract(isodow from first_day)::integer - 1);
  -- Bounded civil-date iteration also counts monthly rules which skip missing month days.
  for day_value in select first_day + i from generate_series(0, candidate - first_day) i loop
    month_diff := (extract(year from day_value)::integer - extract(year from first_day)::integer) * 12
      + extract(month from day_value)::integer - extract(month from first_day)::integer;
    if (e.frequency = 'WEEKLY' and ((day_value - monday) / 7) % e.recurrence_interval = 0
          and extract(isodow from day_value)::integer = any(e.weekdays))
      or (e.frequency = 'MONTHLY' and month_diff % e.recurrence_interval = 0
          and extract(day from day_value) = extract(day from first_day)) then
      n := n + 1;
      if e.occurrence_count is not null and n > e.occurrence_count then return false; end if;
      if day_value = candidate then return true; end if;
    end if;
  end loop;
  return false;
end;
$$;

create function public.save_agenda_event(target_id uuid, expected_revision bigint, details jsonb, participant_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare candidate public.events; previous public.events; saved_id uuid;
begin
  perform public.agenda_require_permission(case when target_id is null then 'events.create' else 'events.update' end);
  if jsonb_typeof(details) is distinct from 'object' then raise exception 'Invalid event' using errcode = '22023'; end if;
  candidate := jsonb_populate_record(null::public.events, details);
  if participant_ids is null or cardinality(participant_ids) > 5000 or array_position(participant_ids, null) is not null
    or cardinality(participant_ids) <> (select count(distinct x) from unnest(participant_ids) x)
    or (candidate.audience_type = 'ALL' and cardinality(participant_ids) <> 0)
    or (candidate.audience_type = 'SELECTED' and cardinality(participant_ids) = 0) then
    raise exception 'Invalid participants' using errcode = '22023';
  end if;
  if cardinality(candidate.weekdays) <> (select count(distinct x) from unnest(candidate.weekdays) x) then
    raise exception 'Duplicate weekdays' using errcode = '22023';
  end if;
  if target_id is not null then
    select * into previous from public.events where id = target_id for update;
    if not found or previous.revision is distinct from expected_revision then
      raise exception 'Event changed; reload before saving' using errcode = '40001';
    end if;
    if previous.status = 'CANCELLED' then raise exception 'Event cancelled' using errcode = '22023'; end if;
  end if;
  -- Keep historical archived participants; reject new archived selections and nonexistent IDs.
  if exists (select 1 from unnest(participant_ids) p left join public.members m on m.id = p
    where m.id is null or (not m.active and not exists (
      select 1 from public.event_participants ep where ep.event_id = target_id and ep.member_id = p))) then
    raise exception 'Participant missing or archived' using errcode = '22023';
  end if;
  if target_id is null then
    insert into public.events(title, description, category, location, all_day, start_date, end_date, starts_at, ends_at,
      timezone, audience_type, frequency, recurrence_interval, weekdays, until_date, occurrence_count, created_by, updated_by)
    values(candidate.title, candidate.description, candidate.category, candidate.location, candidate.all_day,
      candidate.start_date, candidate.end_date, candidate.starts_at, candidate.ends_at, candidate.timezone,
      candidate.audience_type, candidate.frequency, candidate.recurrence_interval, candidate.weekdays,
      candidate.until_date, candidate.occurrence_count, auth.uid(), auth.uid()) returning id into saved_id;
    insert into public.event_reminders(event_id, kind, days_before, local_time)
      select saved_id, 'LOCAL_TIME', d, time '19:00' from unnest(case candidate.category
        when 'ACTIVITY' then array[1] when 'WEEKEND' then array[7,1] when 'CAMP' then array[14,7,1] else array[]::integer[] end) d;
  else
    update public.events set title = candidate.title, description = candidate.description, category = candidate.category,
      location = candidate.location, all_day = candidate.all_day, start_date = candidate.start_date, end_date = candidate.end_date,
      starts_at = candidate.starts_at, ends_at = candidate.ends_at, timezone = candidate.timezone,
      audience_type = candidate.audience_type, frequency = candidate.frequency, recurrence_interval = candidate.recurrence_interval,
      weekdays = candidate.weekdays, until_date = candidate.until_date, occurrence_count = candidate.occurrence_count,
      updated_by = auth.uid(), updated_at = clock_timestamp(), revision = revision + 1
      where id = target_id returning * into candidate;
    if exists (select 1 from public.event_occurrence_overrides o where o.event_id = target_id
      and (candidate.frequency = 'NONE' or not public.agenda_is_occurrence(candidate, o.occurrence_date))) then
      raise exception 'This recurrence change would orphan exceptions; preserve their original dates' using errcode = '22023';
    end if;
    saved_id := target_id;
  end if;
  delete from public.event_participants where event_id = saved_id and not (member_id = any(participant_ids));
  insert into public.event_participants(event_id, member_id) select saved_id, p from unnest(participant_ids) p
    on conflict (event_id, member_id) do nothing;
  return saved_id;
end;
$$;

create function public.save_agenda_occurrence(target_id uuid, original_date date, expected_revision bigint, details jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare parent public.events; candidate public.event_occurrence_overrides;
begin
  perform public.agenda_require_permission('events.update');
  select * into parent from public.events where id = target_id for update;
  if not found or parent.revision is distinct from expected_revision then
    raise exception 'Event changed; reload before saving' using errcode = '40001'; end if;
  if parent.status = 'CANCELLED' or parent.frequency = 'NONE' or not public.agenda_is_occurrence(parent, original_date) then
    raise exception 'Invalid occurrence' using errcode = '22023'; end if;
  if exists (select 1 from public.event_occurrence_overrides where event_id = target_id and occurrence_date = original_date and status = 'CANCELLED') then
    raise exception 'Occurrence cancelled' using errcode = '22023'; end if;
  if jsonb_typeof(details) is distinct from 'object' then raise exception 'Invalid occurrence' using errcode = '22023'; end if;
  candidate := jsonb_populate_record(null::public.event_occurrence_overrides, details);
  insert into public.event_occurrence_overrides(event_id, occurrence_date, title, description, category, location,
    all_day, start_date, end_date, starts_at, ends_at, timezone, updated_by)
    values (target_id, original_date, candidate.title, candidate.description, candidate.category, candidate.location,
      candidate.all_day, candidate.start_date, candidate.end_date, candidate.starts_at, candidate.ends_at, candidate.timezone, auth.uid())
    on conflict (event_id, occurrence_date) do update set title = excluded.title, description = excluded.description,
      category = excluded.category, location = excluded.location, all_day = excluded.all_day, start_date = excluded.start_date,
      end_date = excluded.end_date, starts_at = excluded.starts_at, ends_at = excluded.ends_at, timezone = excluded.timezone,
      updated_by = auth.uid(), updated_at = clock_timestamp();
  update public.events set revision = revision + 1, updated_by = auth.uid(), updated_at = clock_timestamp() where id = target_id;
end;
$$;

create function public.cancel_agenda_event(target_id uuid, original_date date, expected_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare parent public.events; first_day date; day_offset integer; shifted_start timestamptz; shifted_end timestamptz;
begin
  perform public.agenda_require_permission('events.delete');
  select * into parent from public.events where id = target_id for update;
  if not found or parent.revision is distinct from expected_revision then
    raise exception 'Event changed; reload before saving' using errcode = '40001'; end if;
  if original_date is null then
    update public.events set status = 'CANCELLED', revision = revision + 1,
      updated_at = clock_timestamp(), updated_by = auth.uid() where id = target_id;
    return;
  end if;
  if parent.frequency = 'NONE' or parent.status = 'CANCELLED' or not public.agenda_is_occurrence(parent, original_date) then
    raise exception 'Invalid occurrence' using errcode = '22023'; end if;
  first_day := coalesce(parent.start_date, (parent.starts_at at time zone 'Europe/Brussels')::date);
  day_offset := original_date - first_day;
  shifted_start := ((parent.starts_at at time zone 'Europe/Brussels') + day_offset * interval '1 day') at time zone 'Europe/Brussels';
  shifted_end := ((parent.ends_at at time zone 'Europe/Brussels') + day_offset * interval '1 day') at time zone 'Europe/Brussels';
  if shifted_end < shifted_start then shifted_end := shifted_start + (parent.ends_at - parent.starts_at); end if;
  insert into public.event_occurrence_overrides(event_id, occurrence_date, title, description, category, location,
    all_day, start_date, end_date, starts_at, ends_at, timezone, status, updated_by)
    values (target_id, original_date, parent.title, parent.description, parent.category, parent.location, parent.all_day,
      parent.start_date + day_offset, parent.end_date + day_offset,
      shifted_start, shifted_end,
      parent.timezone, 'CANCELLED', auth.uid())
    on conflict (event_id, occurrence_date) do update set status = 'CANCELLED', updated_by = auth.uid(), updated_at = clock_timestamp();
  update public.events set revision = revision + 1, updated_by = auth.uid(), updated_at = clock_timestamp() where id = target_id;
end;
$$;

revoke all on function public.agenda_valid_timing(boolean, date, date, timestamptz, timestamptz, text),
  public.agenda_require_permission(text), public.agenda_is_occurrence(public.events, date),
  public.save_agenda_event(uuid, bigint, jsonb, uuid[]), public.save_agenda_occurrence(uuid, date, bigint, jsonb),
  public.cancel_agenda_event(uuid, date, bigint) from public, anon, authenticated;
grant execute on function public.save_agenda_event(uuid, bigint, jsonb, uuid[]),
  public.save_agenda_occurrence(uuid, date, bigint, jsonb), public.cancel_agenda_event(uuid, date, bigint) to authenticated;

commit;
