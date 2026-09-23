import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const sqlFile = (file: string) => readFileSync(new URL(`../../supabase/${file}`, import.meta.url), "utf8");
export const appMarker = "-- BEGIN APP FOUNDATION (mirrors 20260922000200_app_members_rbac.sql)";
export const agendaMarker = "-- BEGIN APP AGENDA (mirrors 20260923000100_app_agenda.sql)";
export const fixtureId = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
export const tasksMarker = "-- BEGIN APP TASKS (mirrors 20260923000200_app_tasks.sql)";
export const financeMarker = "-- BEGIN APP FINANCE (mirrors 20260923000300_app_finance.sql)";
export const notificationsMarker = "-- BEGIN APP NOTIFICATIONS (mirrors 20260923000400_app_notifications.sql)";
export async function database(withTasks = false, withFinance = false, withNotifications = false) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key, bucket_id text); alter table storage.objects enable row level security;
  `);
  await db.exec(sqlFile("schema.sql").split(appMarker)[0].replace("create extension if not exists pgcrypto;", ""));
  for (const file of ["20260922000100_neutral_site_role.sql", "20260922000200_app_members_rbac.sql", "20260923000100_app_agenda.sql"]) await db.exec(sqlFile(`migrations/${file}`));
  if (withTasks || withFinance || withNotifications) await db.exec(sqlFile("migrations/20260923000200_app_tasks.sql"));
  if (withFinance || withNotifications) await db.exec(sqlFile("migrations/20260923000300_app_finance.sql"));
  if (withNotifications) await db.exec(sqlFile("migrations/20260923000400_app_notifications.sql"));
  return db;
}
