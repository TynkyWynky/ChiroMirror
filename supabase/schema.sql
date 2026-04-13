create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  role text not null default 'editor' check (role in ('admin', 'editor')),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles add column if not exists email text not null default '';

create table if not exists public.site_settings (
  id integer primary key,
  site_name text not null,
  site_url text not null,
  logo_url text not null,
  email text not null,
  facebook_url text not null,
  instagram_url text not null,
  address text not null,
  address_note text not null,
  map_embed_url text not null,
  map_google_url text not null,
  map_apple_url text not null,
  footer_copyright text not null,
  footer_developer text not null,
  analytics_id text not null default '',
  footer_admin_label text not null default 'Leiding'
);

create table if not exists public.page_content (
  slug text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  theme_key text not null,
  age_range text not null default '',
  birth_years text not null default '',
  school_years text not null default '',
  description text not null default '',
  image_url text not null default '',
  image_alt text not null default '',
  sort_order integer not null default 0,
  leaders jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.contact_sections (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  accent_color text not null default '#94a3b8',
  sort_order integer not null default 0,
  people jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  lyrics text not null default '',
  sort_order integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null default '',
  body text not null default '',
  event_date date,
  published boolean not null default false,
  featured boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.contact_messages (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null,
  subject text not null,
  category text not null,
  message text not null,
  created_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'contact_messages_name_length_chk'
  ) then
    alter table public.contact_messages
      add constraint contact_messages_name_length_chk
      check (char_length(name) between 2 and 120);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'contact_messages_subject_length_chk'
  ) then
    alter table public.contact_messages
      add constraint contact_messages_subject_length_chk
      check (char_length(subject) between 3 and 160);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'contact_messages_category_length_chk'
  ) then
    alter table public.contact_messages
      add constraint contact_messages_category_length_chk
      check (char_length(category) between 2 and 80);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'contact_messages_message_length_chk'
  ) then
    alter table public.contact_messages
      add constraint contact_messages_message_length_chk
      check (char_length(message) between 10 and 5000);
  end if;
end
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists page_content_set_updated_at on public.page_content;
create trigger page_content_set_updated_at
before update on public.page_content
for each row execute procedure public.set_updated_at();

drop trigger if exists groups_set_updated_at on public.groups;
create trigger groups_set_updated_at
before update on public.groups
for each row execute procedure public.set_updated_at();

drop trigger if exists contact_sections_set_updated_at on public.contact_sections;
create trigger contact_sections_set_updated_at
before update on public.contact_sections
for each row execute procedure public.set_updated_at();

drop trigger if exists songs_set_updated_at on public.songs;
create trigger songs_set_updated_at
before update on public.songs
for each row execute procedure public.set_updated_at();

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
before update on public.posts
for each row execute procedure public.set_updated_at();

create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_profile();

create or replace function public.is_site_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and role in ('admin', 'editor')
  );
$$;

create or replace function public.is_site_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and role = 'admin'
  );
$$;

grant execute on function public.is_site_editor() to anon, authenticated;
grant execute on function public.is_site_admin() to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.site_settings enable row level security;
alter table public.page_content enable row level security;
alter table public.groups enable row level security;
alter table public.contact_sections enable row level security;
alter table public.songs enable row level security;
alter table public.posts enable row level security;
alter table public.contact_messages enable row level security;

drop policy if exists "Profiles self read" on public.profiles;
create policy "Profiles self read"
on public.profiles
for select
to authenticated
using (user_id = auth.uid() or public.is_site_admin());

drop policy if exists "Profiles self update" on public.profiles;
drop policy if exists "Profiles admin update" on public.profiles;
create policy "Profiles admin update"
on public.profiles
for update
to authenticated
using (public.is_site_admin())
with check (public.is_site_admin());

drop policy if exists "Profiles admin insert" on public.profiles;
create policy "Profiles admin insert"
on public.profiles
for insert
to authenticated
with check (public.is_site_admin());

drop policy if exists "Public site settings read" on public.site_settings;
create policy "Public site settings read"
on public.site_settings
for select
to anon, authenticated
using (true);

drop policy if exists "Editors manage site settings" on public.site_settings;
create policy "Editors manage site settings"
on public.site_settings
for all
to authenticated
using (public.is_site_editor())
with check (public.is_site_editor());

drop policy if exists "Public page content read" on public.page_content;
create policy "Public page content read"
on public.page_content
for select
to anon, authenticated
using (true);

drop policy if exists "Editors manage page content" on public.page_content;
create policy "Editors manage page content"
on public.page_content
for all
to authenticated
using (public.is_site_editor())
with check (public.is_site_editor());

drop policy if exists "Public groups read" on public.groups;
create policy "Public groups read"
on public.groups
for select
to anon, authenticated
using (true);

drop policy if exists "Editors manage groups" on public.groups;
create policy "Editors manage groups"
on public.groups
for all
to authenticated
using (public.is_site_editor())
with check (public.is_site_editor());

drop policy if exists "Public contact sections read" on public.contact_sections;
create policy "Public contact sections read"
on public.contact_sections
for select
to anon, authenticated
using (true);

drop policy if exists "Editors manage contact sections" on public.contact_sections;
create policy "Editors manage contact sections"
on public.contact_sections
for all
to authenticated
using (public.is_site_editor())
with check (public.is_site_editor());

drop policy if exists "Public songs read" on public.songs;
create policy "Public songs read"
on public.songs
for select
to anon, authenticated
using (true);

drop policy if exists "Editors manage songs" on public.songs;
create policy "Editors manage songs"
on public.songs
for all
to authenticated
using (public.is_site_editor())
with check (public.is_site_editor());

drop policy if exists "Public posts read" on public.posts;
create policy "Public posts read"
on public.posts
for select
to anon, authenticated
using (published = true);

drop policy if exists "Editors read all posts" on public.posts;
create policy "Editors read all posts"
on public.posts
for select
to authenticated
using (public.is_site_editor());

drop policy if exists "Editors manage posts" on public.posts;
create policy "Editors manage posts"
on public.posts
for all
to authenticated
using (public.is_site_editor())
with check (public.is_site_editor());

drop policy if exists "Editors read contact messages" on public.contact_messages;
create policy "Editors read contact messages"
on public.contact_messages
for select
to authenticated
using (public.is_site_editor());

drop policy if exists "Editors delete contact messages" on public.contact_messages;
create policy "Editors delete contact messages"
on public.contact_messages
for delete
to authenticated
using (public.is_site_editor());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-media',
  'site-media',
  true,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public media read" on storage.objects;
create policy "Public media read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'site-media');

drop policy if exists "Editors upload media" on storage.objects;
create policy "Editors upload media"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'site-media' and public.is_site_editor());

drop policy if exists "Editors update media" on storage.objects;
create policy "Editors update media"
on storage.objects
for update
to authenticated
using (bucket_id = 'site-media' and public.is_site_editor())
with check (bucket_id = 'site-media' and public.is_site_editor());

drop policy if exists "Editors delete media" on storage.objects;
create policy "Editors delete media"
on storage.objects
for delete
to authenticated
using (bucket_id = 'site-media' and public.is_site_editor());
