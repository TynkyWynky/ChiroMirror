import assert from "node:assert/strict";
import { test } from "node:test";
import { database, fixtureId as id, sqlFile, agendaMarker } from "./helpers/database.ts";

const base = {
  title: "Activité du dimanche", description: "", location: "Locaux", category: "ACTIVITY", timezone: "Europe/Brussels",
  all_day: false, start_date: null, end_date: null, starts_at: "2026-03-22T13:00:00Z", ends_at: "2026-03-22T17:00:00Z",
  audience_type: "ALL", frequency: "WEEKLY", recurrence_interval: 1, weekdays: [7], until_date: null, occurrence_count: null
};

test("Agenda migrations, RLS, atomic writes, participants, exceptions and optimistic concurrency", async () => {
  const db = await database();
  try {
    for (let n = 1; n <= 8; n++) await db.query("insert into auth.users(id, email) values ($1,$2)", [id(n), `test${n}@example.test`]);
    await db.exec(`update public.profiles set role = 'admin' where user_id = '${id(2)}';
      insert into public.app_user_roles(user_id, role_key) values ('${id(3)}','MEMBER'), ('${id(4)}','TREASURER'), ('${id(5)}','RESPONSIBLE'), ('${id(6)}','APP_ADMIN');
      insert into public.members(id, first_name,last_name,user_id) values ('${id(11)}','Avec','Compte','${id(3)}'),('${id(12)}','Sans','Compte',null);
      insert into public.members(id, first_name,last_name,active) values ('${id(13)}','Ancien','Membre',false);
    `);
    async function actor(n: number, action: () => Promise<void>) {
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '${id(n)}'`);
      try { await action(); } finally { await db.exec("reset role; reset request.jwt.claim.sub"); }
    }
    async function value<T>(sql: string, params: unknown[] = []) { return (await db.query<{ v: T }>(sql, params)).rows[0].v; }
    const save = (target: string | null, revision: number | null, details: object = base, participants: string[] = []) =>
      value<string>("select public.save_agenda_event($1,$2,$3,$4) v", [target, revision, details, participants]);
    const cancel = (target: string, date: string | null, revision: number) => db.query("select public.cancel_agenda_event($1,$2,$3)", [target, date, revision]);
    const override = (target: string, date: string, revision: number, details: object = base) => db.query("select public.save_agenda_occurrence($1,$2,$3,$4)", [target, date, revision, details]);
    let series = "";
    await actor(5, async () => {
      series = await save(null, null, { ...base, created_by: id(2), updated_by: id(2), status: "CANCELLED" });
      assert.equal(await value("select created_by v from public.events where id=$1", [series]), id(5));
      assert.equal(await value("select status v from public.events where id=$1", [series]), "SCHEDULED");
      assert.equal(await value("select count(*)::int v from public.event_participants where event_id=$1", [series]), 0);
      assert.equal(await value("select days_before v from public.event_reminders where event_id=$1", [series]), 1);
      assert.equal(await value("select local_time::text v from public.event_reminders where event_id=$1", [series]), "19:00:00");
      assert.equal(await value("select public.is_site_editor() v"), false);
    });
    for (const n of [1, 2]) await actor(n, async () => {
      assert.equal(await value("select count(*)::int v from public.events"), 0);
      for (const table of ["event_categories", "event_participants", "event_occurrence_overrides", "event_reminders"]) {
        assert.equal(await value(`select count(*)::int v from public.${table}`), 0);
      }
      await assert.rejects(save(null, null), /permission denied/);
      await assert.rejects(save(series, 1), /permission denied/);
      await assert.rejects(cancel(series, null, 1), /permission denied/);
    });
    for (const n of [3, 4]) await actor(n, async () => {
      assert.equal(await value("select count(*)::int v from public.events"), 1);
      assert.equal(await value("select count(*)::int v from public.event_categories"), 7);
      await assert.rejects(save(null, null), /permission denied/);
      await assert.rejects(save(series, 1), /permission denied/);
      await assert.rejects(override(series, "2026-03-29", 1), /permission denied/);
      await assert.rejects(cancel(series, "2026-03-29", 1), /permission denied/);
    });
    await actor(6, async () => {
      // Direct writes and creator spoofing are blocked even for APP_ADMIN.
      for (const table of ["events", "event_participants", "event_occurrence_overrides", "event_reminders", "event_categories"]) {
        await assert.rejects(db.exec(`delete from public.${table}`), /permission denied/);
      }
      await assert.rejects(db.exec("update public.events set created_by = auth.uid()"), /permission denied/);
      await assert.rejects(db.exec(`insert into public.event_participants values ('${series}','${id(11)}')`), /permission denied/);
      for (const details of [ { ...base, title: " " }, { ...base, category: "UNKNOWN" }, { ...base, ends_at: "2026-03-21T12:00Z" },
        { ...base, timezone: "UTC" }, { ...base, start_date: "2026-03-22" }, { ...base, recurrence_interval: 0 },
        { ...base, weekdays: [1] }, { ...base, weekdays: [7,7] }, { ...base, occurrence_count: -1 },
        { ...base, until_date: "2026-03-01" }, { ...base, frequency: "DAILY" } ]) await assert.rejects(save(null, null, details));
      for (const participants of [[id(11), id(11)], [id(13)], [id(999)], []]) {
        await assert.rejects(save(null, null, { ...base, audience_type: "SELECTED" }, participants));
      }
      await assert.rejects(save(null, null, base, [id(11)]), /Invalid participants/);
      assert.equal(await value("select count(*)::int v from public.events"), 1, "invalid atomic operations did not leave events");
      await save(series, 1, { ...base, audience_type: "SELECTED" }, [id(11), id(12)]);
      assert.equal(await value("select count(*)::int v from public.event_participants where event_id=$1", [series]), 2);
      assert.equal(await value("select updated_by v from public.events where id=$1", [series]), id(6));
      await assert.rejects(save(series, 1, base), /Event changed/);
      await assert.rejects(save(series, 2, { ...base, audience_type: "SELECTED", title: "Must rollback" }, [id(13)]), /archived/);
      assert.equal(await value("select title v from public.events where id=$1", [series]), base.title);
    });
    await db.exec(`update public.members set active=false where id='${id(12)}'`);
    await actor(5, async () => {
      await save(series, 2, { ...base, audience_type: "SELECTED", title: "Titre modifié" }, [id(11), id(12)]);
      await override(series, "2026-03-29", 3, { ...base, title: "Une occurrence", starts_at: "2026-04-01T18:00:00Z", ends_at: "2026-04-01T20:00:00Z", location: "Autre lieu", status: "CANCELLED" });
      assert.equal(await value("select title v from public.events where id=$1", [series]), "Titre modifié");
      assert.equal(await value("select status v from public.event_occurrence_overrides where event_id=$1", [series]), "SCHEDULED", "editing cannot cancel through update permission");
      assert.equal(await value("select location v from public.event_occurrence_overrides where event_id=$1", [series]), "Autre lieu");
      await assert.rejects(override(series, "2026-03-30", 4), /Invalid occurrence/);
      await assert.rejects(override(series, "2026-03-29", 3), /Event changed/);
      await assert.rejects(save(series, 4, { ...base, until_date: "2026-03-22" }), /orphan exceptions/);
      assert.equal(await value("select revision::int v from public.events where id=$1", [series]), 4);
      await save(series, 4, { ...base, title: "Série modifiée" });
      assert.equal(await value("select title v from public.event_occurrence_overrides where event_id=$1", [series]), "Une occurrence", "series edit preserves exceptions");
      await cancel(series, "2026-03-29", 5);
      assert.equal(await value("select status v from public.events where id=$1", [series]), "SCHEDULED");
      assert.equal(await value("select status v from public.event_occurrence_overrides where event_id=$1", [series]), "CANCELLED");
      await assert.rejects(override(series, "2026-03-29", 6), /Occurrence cancelled/);
      await cancel(series, "2026-10-25", 6);
      assert.equal(await value("select (starts_at at time zone 'Europe/Brussels')::text v from public.event_occurrence_overrides where event_id=$1 and occurrence_date='2026-10-25'", [series]), "2026-10-25 14:00:00");
      await cancel(series, null, 7);
      assert.equal(await value("select status v from public.events where id=$1", [series]), "CANCELLED");
      await assert.rejects(save(series, 8), /cancelled/);
    });
    await actor(6, async () => {
      const camp = await save(null, null, { ...base, category: "CAMP", all_day: true, start_date: "2026-07-16", end_date: "2026-07-30", starts_at: null, ends_at: null, frequency: "NONE", weekdays: [] });
      assert.equal(await value("select start_date::text v from public.events where id=$1", [camp]), "2026-07-16");
      assert.equal(await value("select count(*)::int v from public.event_reminders where event_id=$1", [camp]), 3);
      await cancel(camp, null, 1);
      const monthly = await save(null, null, { ...base, all_day: true, start_date: "2026-01-31", end_date: "2026-02-02", starts_at: null, ends_at: null, frequency: "MONTHLY", weekdays: [], occurrence_count: 2 });
      await cancel(monthly, "2026-03-31", 1);
      await assert.rejects(cancel(monthly, "2026-02-28", 2), /Invalid occurrence/);
      await assert.rejects(cancel(monthly, "2026-05-31", 2), /Invalid occurrence/);
      const short = await save(null, null, { ...base, starts_at: "2026-03-22T01:30:00Z", ends_at: "2026-03-22T02:00:00Z" });
      await cancel(short, "2026-03-29", 1);
      assert.equal(await value("select (ends_at at time zone 'Europe/Brussels')::text v from public.event_occurrence_overrides where event_id=$1", [short]), "2026-03-29 04:00:00");
    });
    // Test individual permissions, rather than relying only on the initial broad role matrix.
    await db.exec(`insert into public.app_roles(key,label) values ('CREATE_ONLY','Test create'),('UPDATE_ONLY','Test update');
      insert into public.app_role_permissions values ('CREATE_ONLY','app.access'),('CREATE_ONLY','events.create'),('UPDATE_ONLY','app.access'),('UPDATE_ONLY','events.update');
      insert into public.app_user_roles(user_id,role_key) values ('${id(7)}','CREATE_ONLY'),('${id(8)}','UPDATE_ONLY');`);
    let separate = "";
    await actor(7, async () => {
      separate = await save(null, null);
      await assert.rejects(save(separate, 1), /permission denied/);
      await assert.rejects(cancel(separate, null, 1), /permission denied/);
    });
    await actor(8, async () => {
      await assert.rejects(save(null, null), /permission denied/);
      await save(separate, 1, { ...base, title: "Update only", status: "CANCELLED" });
      await assert.rejects(cancel(separate, null, 2), /permission denied/);
    });
    assert.equal(await value("select status v from public.events where id=$1", [separate]), "SCHEDULED");
    await db.exec("set role anon");
    await assert.rejects(db.exec("select * from public.events"), /permission denied/);
    await assert.rejects(save(null, null), /permission denied/);
    await db.exec("reset role");
    assert.equal(sqlFile("schema.sql").split(agendaMarker)[1]?.split("-- BEGIN APP TASKS")[0].trim(), sqlFile("migrations/20260923000100_app_agenda.sql").trim());
  } finally { await db.close(); }
});
