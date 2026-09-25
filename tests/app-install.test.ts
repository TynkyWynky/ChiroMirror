import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAppInstallSql, appMigrationFiles } from "../scripts/prepare-app-install.mjs";
import { legacyDatabase, fixtureId, sqlFile } from "./helpers/database.ts";

test("APP install bundle preserves the legacy prerequisite and APP migrations in order", () => {
  const bundle = sqlFile("install-app.sql").replaceAll("\r\n", "\n");
  assert.equal(bundle, buildAppInstallSql(), "Regenerate the bundle when migrations change");
  assert.deepEqual([...bundle.matchAll(/^-- BEGIN MIGRATION (.+)$/gm)].map(match => match[1]), appMigrationFiles);
  assert.equal((bundle.match(/^begin;$/gm) ?? []).length, 1);
  assert.equal((bundle.match(/^commit;$/gm) ?? []).length, 1);
});

test("APP installs with the reported eight-table SITE schema and editor-only legacy roles", async () => {
  const db = await legacyDatabase();
  const bundle = sqlFile("install-app.sql");
  const scalar = async (sql: string) => (await db.query<{ v: unknown }>(sql)).rows[0]?.v;
  try {
    await db.exec(`drop table public.finance_transactions cascade;
      drop function public.can_manage_group(text) cascade;
      alter table public.profiles drop column managed_group_slugs;
      alter table public.profiles alter column role set default 'editor';
      alter table public.profiles drop constraint profiles_role_check;
      alter table public.profiles add constraint profiles_role_check check(role in ('admin','editor'));
      alter table public.profiles drop constraint profiles_user_id_fkey;
      alter table public.profiles add constraint profiles_user_id_fkey foreign key(user_id) references auth.users(id);`);
    // The export contains table definitions, not functions. Model the existing
    // profile trigger with its old editor role to match the reported constraint.
    const trigger = sqlFile("schema.sql").match(/create or replace function public\.handle_new_profile\(\)[\s\S]*?\$\$;/)?.[0];
    assert.ok(trigger);
    await db.exec(trigger.replace("'none'", "'editor'"));
    assert.equal(await scalar("select count(*)::int v from pg_tables where schemaname='public'"), 8);
    await db.query("insert into auth.users(id,email) values ($1,'existing-admin@example.test'),($2,'existing-editor@example.test')", [fixtureId(1), fixtureId(2)]);
    await db.query("update public.profiles set role='admin' where user_id=$1", [fixtureId(1)]);
    await db.query("update public.profiles set role='editor' where user_id=$1", [fixtureId(2)]);
    const before = (await db.query("select * from public.profiles order by user_id")).rows;
    await assert.rejects(db.exec(bundle.replace("create table public.tasks (", "create table public.members (")), /already exists/);
    await db.exec("rollback");
    assert.equal(await scalar("select count(*)::int v from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='managed_group_slugs'"), 0);
    assert.deepEqual((await db.query("select * from public.profiles order by user_id")).rows, before);

    await db.exec(bundle);
    assert.equal(await scalar("select to_regclass('public.finance_transactions') v"), null, "APP finance does not depend on the old SITE finance table");
    assert.deepEqual((await db.query("select user_id,email,full_name,role,created_at from public.profiles order by user_id")).rows, before);
    assert.ok((await db.query<{ managed_group_slugs: unknown }>("select managed_group_slugs from public.profiles")).rows.every(row => Array.isArray(row.managed_group_slugs) && row.managed_group_slugs.length === 0));
    const verification = await db.exec(sqlFile("verify-app.sql"));
    assert.ok((verification[0].rows as { installed: boolean; rls_enabled: boolean }[]).every(row => row.installed && row.rls_enabled));
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${fixtureId(2)}'`);
    assert.equal(await scalar("select public.can_manage_group('ribbels') v"), false, "No implicit group assignment");
    await db.exec("reset role; reset request.jwt.claim.sub");
    await db.query("insert into auth.users(id,email) values ($1,'new-account@example.test')", [fixtureId(3)]);
    assert.equal(await scalar("select role v from public.profiles where email='new-account@example.test'"), "none", "Only new accounts change to the neutral default");
    await db.exec(sqlFile("bootstrap-app-admin.sql").replace("'REPLACE_WITH_VERIFIED_EMAIL'", "'existing-admin@example.test'"));
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${fixtureId(1)}'`);
    const access = (await db.query<{ v: { permissions: string[] } }>("select public.get_my_app_access() v")).rows[0].v;
    assert.ok(access.permissions.includes("app.access"));
    assert.ok(access.permissions.includes("members.manage"));
    await db.exec("reset role; reset request.jwt.claim.sub");
  } finally {
    await db.close();
  }
});

test("legacy profile prerequisite preserves assignments and refuses an incompatible column", async () => {
  const db = await legacyDatabase();
  const migration = sqlFile("migrations/20260922000000_legacy_profile_groups.sql");
  try {
    await db.query("insert into auth.users(id,email) values ($1,'editor@example.test')", [fixtureId(1)]);
    await db.exec("update public.profiles set managed_group_slugs='[\"ribbels\"]'::jsonb");
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual((await db.query("select managed_group_slugs from public.profiles")).rows, [{ managed_group_slugs: ["ribbels"] }]);
    await db.exec("drop function public.can_manage_group(text) cascade; alter table public.profiles drop column managed_group_slugs; alter table public.profiles add column managed_group_slugs text default 'existing'");
    await assert.rejects(db.exec(migration), /must be jsonb/);
    await db.exec("rollback");
    assert.deepEqual((await db.query("select managed_group_slugs from public.profiles")).rows, [{ managed_group_slugs: "existing" }]);
  } finally {
    await db.close();
  }
});

test("APP installs when the older SITE has no can_manage_group helper", async () => {
  const db = await legacyDatabase();
  const bundle = sqlFile("install-app.sql");
  const scalar = async (sql: string) => (await db.query<{ v: unknown }>(sql)).rows[0]?.v;
  try {
    // Emulate a SITE predating the group-finance helper. Only this ephemeral
    // fixture drops the dependent legacy policies; the installer drops none.
    await db.exec("drop function public.can_manage_group(text) cascade");
    assert.equal(await scalar("select to_regprocedure('public.can_manage_group(text)') v"), null);
    await db.query("insert into auth.users(id,email) values ($1,'admin@example.test'),($2,'editor@example.test'),($3,'neutral@example.test')",
      [fixtureId(1), fixtureId(2), fixtureId(3)]);
    await db.query("update public.profiles set role='admin' where user_id=$1", [fixtureId(1)]);
    await db.query("update public.profiles set role='editor', managed_group_slugs='[\"ribbels\"]'::jsonb where user_id=$1", [fixtureId(2)]);
    await db.query("update public.profiles set role='none', managed_group_slugs='[\"ribbels\"]'::jsonb where user_id=$1", [fixtureId(3)]);

    // A later error must also undo creation of the previously missing helper.
    await assert.rejects(db.exec(bundle.replace("create table public.tasks (", "create table public.members (")), /already exists/);
    await db.exec("rollback");
    assert.equal(await scalar("select to_regprocedure('public.can_manage_group(text)') v"), null);

    await db.exec(bundle);
    assert.equal(await scalar("select to_regprocedure('public.can_manage_group(text)') is not null v"), true);
    assert.equal(await scalar("select count(*)::int v from public.app_user_roles"), 0);
    for (const [actor, group, expected] of [[1, "ribbels", true], [2, "ribbels", true], [2, "other", false], [3, "ribbels", false]] as const) {
      await db.exec(`set role authenticated; set request.jwt.claim.sub='${fixtureId(actor)}'`);
      assert.equal((await db.query<{ v: boolean }>("select public.can_manage_group($1) v", [group])).rows[0].v, expected);
      await db.exec("reset role; reset request.jwt.claim.sub");
    }
  } finally {
    await db.close();
  }
});

test("APP install is atomic, refuses partial/repeated installs and bootstraps only one selected account", async () => {
  const db = await legacyDatabase();
  const bundle = sqlFile("install-app.sql");
  const bootstrap = sqlFile("bootstrap-app-admin.sql");
  const scalar = async (sql: string) => (await db.query<{ v: unknown }>(sql)).rows[0]?.v;
  async function rejectsSql(sql: string, message: RegExp) {
    await assert.rejects(db.exec(sql), message);
    await db.exec("rollback");
  }
  try {
    await db.exec("alter table public.profiles alter column role set default 'editor'");
    await db.query("insert into auth.users(id,email) values ($1,'admin@example.test'),($2,'member@example.test')", [fixtureId(1), fixtureId(2)]);
    await db.query("update public.profiles set role='admin' where user_id=$1", [fixtureId(1)]);
    await db.query("insert into public.posts(title,body) values ('Existing SITE content','Keep this content')");

    await db.exec("create table public.members(id integer)");
    await rejectsSql(bundle, /APP objects already exist/);
    assert.equal(await scalar("select column_default v from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='role'"), "'editor'::text");
    await db.exec("drop table public.members");

    await db.exec("create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key); insert into supabase_migrations.schema_migrations values('20260923000100')");
    await rejectsSql(bundle, /APP migration history exists/);
    await db.exec("drop schema supabase_migrations cascade");

    // Simulate a late failing phase. Even the earlier neutral-role migration
    // and completed foundation/agenda phases must be rolled back together.
    await rejectsSql(bundle.replace("create table public.tasks (", "create table public.members ("), /already exists/);
    assert.equal(await scalar("select to_regclass('public.members') v"), null);
    assert.equal(await scalar("select to_regprocedure('public.has_app_access()') v"), null);
    assert.equal(await scalar("select column_default v from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='role'"), "'editor'::text");

    await db.exec(bundle);
    assert.equal(await scalar("select count(*)::int v from public.app_user_roles"), 0, "No automatic APP role rows");
    assert.equal(await scalar("select role v from public.profiles where email='admin@example.test'"), "admin");
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${fixtureId(2)}'`);
    assert.equal(await scalar("select public.has_app_access() v"), true, "Every authenticated account gets baseline APP access");
    assert.equal(await scalar("select public.has_app_permission('members.manage') v"), false, "Baseline access does not grant member management");
    assert.equal(await scalar("select public.has_app_permission('finance.treasury.manage') v"), false, "Baseline access does not grant treasury management");
    await db.exec("reset role; reset request.jwt.claim.sub");
    assert.equal(await scalar("select body v from public.posts where title='Existing SITE content'"), "Keep this content");
    const verification = await db.exec(sqlFile("verify-app.sql"));
    const tableRows = verification[0].rows as { installed: boolean; rls_enabled: boolean }[];
    assert.equal(tableRows.length, 28);
    assert.ok(tableRows.every(row => row.installed && row.rls_enabled));
    const functions = verification[1].rows as { signature: string; installed: boolean; anon_can_execute: boolean; authenticated_can_execute: boolean }[];
    assert.ok(functions.every(row => row.installed && !row.anon_can_execute));
    assert.ok(functions.every(row => row.authenticated_can_execute === !row.signature.includes("claim_notification_sources")));
    await rejectsSql(bundle, /APP objects already exist/);

    await rejectsSql(bootstrap, /Set target_email/);
    await rejectsSql(bootstrap.replace("'REPLACE_WITH_VERIFIED_EMAIL'", "'unknown@example.test'"), /exactly one Auth account/);
    const selectedBootstrap = bootstrap.replace("'REPLACE_WITH_VERIFIED_EMAIL'", "'admin@example.test'");
    await db.exec(selectedBootstrap);
    await db.exec(selectedBootstrap);
    assert.equal(await scalar("select count(*)::int v from public.app_user_roles"), 1);
    assert.equal(await scalar("select role_key v from public.app_user_roles"), "APP_ADMIN");
    assert.equal(await scalar("select count(*)::int v from public.members"), 0, "No invented membership");
    await rejectsSql(bootstrap.replace("'REPLACE_WITH_VERIFIED_EMAIL'", "'member@example.test'"), /APP role manager already exists/);
    assert.equal(await scalar("select role v from public.profiles where email='admin@example.test'"), "admin");
  } finally {
    await db.close();
  }
});
