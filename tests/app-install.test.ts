import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAppInstallSql, appMigrationFiles } from "../scripts/prepare-app-install.mjs";
import { legacyDatabase, fixtureId, sqlFile } from "./helpers/database.ts";

test("APP install bundle preserves the six reviewed migrations and their order", () => {
  const bundle = sqlFile("install-app.sql").replaceAll("\r\n", "\n");
  assert.equal(bundle, buildAppInstallSql(), "Regenerate the bundle when migrations change");
  assert.deepEqual([...bundle.matchAll(/^-- BEGIN MIGRATION (.+)$/gm)].map(match => match[1]), appMigrationFiles);
  assert.equal((bundle.match(/^begin;$/gm) ?? []).length, 1);
  assert.equal((bundle.match(/^commit;$/gm) ?? []).length, 1);
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
    assert.equal(await scalar("select count(*)::int v from public.app_user_roles"), 0, "No automatic APP grants");
    assert.equal(await scalar("select role v from public.profiles where email='admin@example.test'"), "admin");
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
