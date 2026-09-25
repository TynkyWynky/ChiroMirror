import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const read = (path: string) => readFileSync(new URL(`../supabase/${path}`, import.meta.url), "utf8");
const migration = read("migrations/20260922000200_app_members_rbac.sql");
const defaultAccessMigration = read("migrations/20260924000200_app_default_access.sql");
const baselineGuardMigration = read("migrations/20260925000300_app_baseline_permission_guard.sql");
const maskAccountEmailsMigration = read("migrations/20260925000400_app_mask_account_emails.sql");
const marker = "-- BEGIN APP FOUNDATION (mirrors 20260922000200_app_members_rbac.sql)";

test("PostgreSQL RLS: account/member separation, role matrix, mutations and SITE isolation", async () => {
  // In-memory PostgreSQL only: no environment URLs, network, real accounts or email.
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key, bucket_id text);
      alter table storage.objects enable row level security;
    `);
    // PGlite has core gen_random_uuid; the Supabase pgcrypto extension is unnecessary here.
    const schema = read("schema.sql");
    const base = schema.split(marker)[0].replace("create extension if not exists pgcrypto;", "");
    await db.exec(base);
    // Exercise the real migration against the pre-Phase-0 default.
    await db.exec("alter table public.profiles alter column role set default 'editor'");
    await assert.rejects(db.exec(migration), /Apply 20260922000100/);
    await db.exec("rollback");
    await db.exec(read("migrations/20260922000100_neutral_site_role.sql"));
    await db.exec(migration);
    await db.exec(defaultAccessMigration);
    await db.exec(baselineGuardMigration);
    await db.exec(maskAccountEmailsMigration);
    const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    for (let n = 1; n <= 7; n++) {
      await db.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)", [id(n), `test${n}@example.test`, { role: "admin" }]);
    }
    await db.exec(`update public.profiles set role = 'admin' where user_id = '${id(2)}';
      insert into public.app_user_roles(user_id, role_key) values
      ('${id(3)}','MEMBER'),('${id(4)}','RESPONSIBLE'),('${id(5)}','TREASURER'),('${id(6)}','APP_ADMIN');
      insert into public.members(first_name,last_name) values ('Initial','Member');`);
    // Supabase default table grants are not reproduced by this harness for legacy SITE tables.
    await db.exec("grant select on public.profiles to authenticated");
    async function actor(n: number, action: () => Promise<void>) {
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '${id(n)}'`);
      try { await action(); } finally { await db.exec("reset role; reset request.jwt.claim.sub"); }
    }
    async function value(sql: string) { return (await db.query<{ v: unknown }>(sql)).rows[0].v; }
    for (const n of [1, 2]) await actor(n, async () => {
      assert.equal(await value("select public.has_app_access() v"), true);
      assert.deepEqual((await value("select public.get_my_app_access() v") as { permissions: string[] }).permissions.sort(), ["app.access", "members.read"]);
      assert.equal(await value("select count(*)::int v from public.members"), 1);
      assert.equal(await value("select count(*)::int v from public.app_user_roles"), 0);
      await assert.rejects(db.exec("insert into public.members(first_name,last_name) values ('No','Access')"));
      await assert.rejects(db.exec("select * from public.list_app_accounts()"));
      assert.equal(await value("select public.is_site_admin() v"), n === 2);
    });
    for (const n of [3, 4, 5]) await actor(n, async () => {
      assert.equal(await value("select public.has_app_access() v"), true);
      assert.equal(await value("select count(*)::int v from public.members"), 1);
      assert.equal(await value("select count(*)::int v from public.app_user_roles"), 1);
      assert.equal(await value("select public.has_app_permission('members.manage') v"), false);
      await assert.rejects(db.exec("insert into public.members(first_name,last_name) values ('No','Write')"));
      assert.equal((await db.query("update public.members set active = false returning id")).rows.length, 0);
      await assert.rejects(db.exec(`select public.set_app_user_roles('${id(n)}', array['APP_ADMIN'])`));
      await assert.rejects(db.exec(`select public.complete_app_member_invitation('${id(1)}','${id(n)}', array['APP_ADMIN'])`), /forbidden/);
      await assert.rejects(db.exec(`insert into public.app_user_roles(user_id,role_key) values ('${id(n)}','APP_ADMIN')`));
      await assert.rejects(db.exec("update public.app_role_permissions set permission_key = 'roles.manage'"));
      await assert.rejects(db.exec("select * from public.list_app_accounts()"));
    });
    await assert.rejects(db.exec("insert into public.app_role_permissions(role_key, permission_key) values ('MEMBER','members.manage')"), /Forbidden permission/);
    await assert.rejects(db.exec("insert into public.app_role_permissions(role_key, permission_key) values ('MEMBER','roles.manage')"), /Forbidden permission/);
    await actor(6, async () => {
      assert.equal(await value("select public.is_site_editor() v"), false);
      assert.equal(await value("select public.can_manage_group('rakwi') v"), false);
      assert.equal(await value("select role v from public.profiles where user_id = auth.uid()"), "none");
      assert.equal(await value("select count(*)::int v from public.list_app_accounts()"), 7);
      assert.equal(await value("select email_masked v from public.list_app_accounts() where user_id = '00000000-0000-0000-0000-000000000001'"), "te***@example.test");
      const member = (await db.query<{ id: string }>(`insert into public.members(first_name,last_name,user_id)
        values ('New','Member','${id(7)}') returning id`)).rows[0].id;
      await db.exec(`update public.members set first_name = 'Changed', active = false where id = '${member}'`);
      assert.equal(await value(`select active v from public.members where id = '${member}'`), false);
      await db.exec(`update public.members set active = true where id = '${member}'`);
      assert.equal(await value(`select first_name v from public.members where id = '${member}'`), "Changed");
      assert.equal(await value(`select active v from public.members where id = '${member}'`), true);
      await assert.rejects(db.exec(`insert into public.members(first_name,last_name,user_id) values ('Duplicate','Link','${id(7)}')`), /unique/);
      await assert.rejects(db.exec("insert into public.members(first_name,last_name) values ('','Invalid')"), /check/);
      await assert.rejects(db.exec("delete from public.members"), /permission denied/);
      await assert.rejects(db.exec(`select public.set_app_user_roles('${id(6)}', array[]::text[])`), /at least one/);
      await assert.rejects(db.exec(`select public.set_app_user_roles('${id(7)}', array['INVALID'])`), /Invalid APP roles/);
      await db.exec(`select public.set_app_user_roles('${id(7)}', array['RESPONSIBLE','TREASURER','RESPONSIBLE'])`);
    });
    await actor(7, async () => {
      const access = await value("select public.get_my_app_access() v") as { permissions: string[]; roles: unknown[]; member: { first_name: string } };
      assert.deepEqual(access.permissions.sort(), ["app.access", "members.read"]);
      assert.equal(access.roles.length, 3);
      assert.equal(access.member.first_name, "Changed");
    });
    // APP baseline access does not depend on a SITE profile row and never creates one.
    await db.exec(`delete from public.profiles where user_id = '${id(7)}'`);
    await actor(7, async () => {
      const access = await value("select public.get_my_app_access() v") as { permissions: string[]; member: { first_name: string } };
      assert.deepEqual(access.permissions.sort(), ["app.access", "members.read"]);
      assert.equal(access.member.first_name, "Changed");
      assert.equal(await value("select public.is_site_admin() v"), false);
    });
    await actor(6, async () => { await db.exec(`select public.set_app_user_roles('${id(7)}', array['TREASURER'])`); });
    await actor(7, async () => { assert.equal(await value("select count(*)::int v from public.app_user_roles"), 1); });
    await actor(6, async () => { await db.exec(`select public.set_app_user_roles('${id(7)}', array[]::text[])`); });
    await actor(7, async () => { assert.equal(await value("select public.has_app_access() v"), true); });
    await actor(6, async () => {
      const target = await value("select id v from public.members where user_id is null limit 1") as string;
      // A unique-link failure must roll back the role grant in the same RPC.
      await assert.rejects(db.exec(`select public.complete_app_member_invitation('${target}','${id(7)}', array['APP_ADMIN'])`), /unique/);
      assert.equal(await value(`select count(*)::int v from public.app_user_roles where user_id = '${id(7)}'`), 0);
      await assert.rejects(db.exec(`select public.complete_app_member_invitation('${target}','${id(1)}', array['INVALID'])`), /Invalid APP roles/);
      assert.equal(await value(`select user_id v from public.members where id = '${target}'`), null);
      await db.exec(`select public.complete_app_member_invitation('${target}','${id(1)}', array['MEMBER'])`);
      assert.equal(await value(`select user_id v from public.members where id = '${target}'`), id(1));
      await assert.rejects(db.exec(`select public.complete_app_member_invitation('${target}','${id(2)}', array['MEMBER'])`), /already linked/);
    });
    await actor(1, async () => { assert.equal(await value("select public.has_app_access() v"), true); });
    await db.exec("set role anon");
    await assert.rejects(db.exec("select * from public.members"), /permission denied/);
    await assert.rejects(db.exec("select public.get_my_app_access()"), /permission denied/);
    await db.exec("reset role");
    assert.equal(schema.split(marker)[1]?.split("-- BEGIN APP AGENDA")[0].trim(), migration.trim(), "bootstrap matches the versioned APP migration");
  } finally { await db.close(); }
});
