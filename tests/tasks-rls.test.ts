import assert from "node:assert/strict";
import { test } from "node:test";
import { database, fixtureId as id, sqlFile, tasksMarker } from "./helpers/database.ts";

const input = { scope: "TEAM", title: "Préparer le souper", description: "", status: "IN_PROGRESS", priority: "HIGH",
  deadline_date: "2026-10-15", deadline_at: null, timezone: "Europe/Brussels", event_id: null, event_occurrence_date: null };
const team = [{ member_id: id(101), role: "LEAD" }, { member_id: id(104), role: "LEAD" }, { member_id: id(102), role: "CONTRIBUTOR" }];

test("Tasks reminders, multiple contributors and rollback after a late write failure", async () => {
  const db = await database(true);
  try {
    await db.exec(`insert into auth.users(id,email) values('${id(1)}','lead@example.test');
      insert into public.app_user_roles(user_id,role_key) values('${id(1)}','RESPONSIBLE');
      insert into public.members(id,user_id,first_name,last_name) values('${id(101)}','${id(1)}','Lead','Test');
      insert into public.members(id,first_name,last_name) values('${id(102)}','One','Test'),('${id(103)}','Two','Test');`);
    const assignments = [{member_id:id(101),role:"LEAD"},{member_id:id(102),role:"CONTRIBUTOR",work_status:"DONE"},{member_id:id(103),role:"CONTRIBUTOR"}];
    const save = async (target: string | null, version: number | null, details: object) => (await db.query<{ v: string }>("select public.save_task($1,$2,$3,$4) v",[target,version,details,assignments])).rows[0].v;
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${id(1)}'`);
    const task = await save(null,null,{...input,description:null});
    assert.equal((await db.query<{n:number}>("select count(*)::int n from public.task_members where work_status='TODO'")).rows[0].n,3, "client cannot set someone else's work status during creation");
    const reminder = async () => (await db.query<{ kind: string; days_before: number | null; offset_minutes: number | null }>("select kind,days_before,offset_minutes from public.task_reminders where task_id=$1",[task])).rows;
    assert.deepEqual(await reminder(),[{kind:"LOCAL_TIME",days_before:1,offset_minutes:null}]);
    await save(task,1,{...input,deadline_date:null,deadline_at:"2026-10-25T18:00:00Z"});
    assert.deepEqual(await reminder(),[{kind:"OFFSET",days_before:null,offset_minutes:1440}]);
    await save(task,2,{...input,deadline_date:null,deadline_at:null});
    assert.deepEqual(await reminder(),[]);
    await db.exec("reset role; reset request.jwt.claim.sub");
    // Fail at the very end, after task, assignments and activity have already been written.
    await db.exec(`create function public.fixture_reject_reminder() returns trigger language plpgsql as $$ begin raise exception 'fixture late failure'; end $$;
      create trigger fixture_reject_reminder before insert on public.task_reminders for each row execute function public.fixture_reject_reminder();`);
    const counts = async () => (await db.query("select (select count(*) from public.tasks)::int tasks,(select count(*) from public.task_members)::int members,(select count(*) from public.task_activity)::int activity")).rows[0];
    const before = await counts();
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${id(1)}'`);
    await assert.rejects(save(null,null,input),/fixture late failure/);
    await assert.rejects(save(task,3,{...input,title:"Must roll back"}),/fixture late failure/);
    await db.exec("reset role; reset request.jwt.claim.sub");
    assert.deepEqual(await counts(),before);
    const retained=(await db.query("select title,revision::int from public.tasks where id=$1",[task])).rows[0];
    assert.deepEqual(retained,{title:input.title,revision:3});
  } finally { await db.close(); }
});

test("Tasks real PostgreSQL: privacy, relational permissions, atomic membership/audit and revisions", async () => {
  const db = await database(true);
  try {
    for (let n = 1; n <= 9; n++) {
      await db.query("insert into auth.users(id,email) values($1,$2)", [id(n), `test${n}@example.test`]);
      await db.query("insert into public.members(id,user_id,first_name,last_name) values($1,$2,'Test',$3)", [id(n+100),id(n),String(n)]);
    }
    await db.exec(`insert into public.members(id,first_name,last_name,active) values('${id(199)}','Ancien','Membre',false);
      update public.profiles set role='admin' where user_id='${id(7)}';
      insert into public.app_user_roles(user_id,role_key) values
      ('${id(1)}','MEMBER'),('${id(2)}','MEMBER'),('${id(3)}','MEMBER'),('${id(4)}','TREASURER'),
      ('${id(5)}','RESPONSIBLE'),('${id(6)}','APP_ADMIN'),('${id(9)}','RESPONSIBLE');`);
    async function actor(n: number, run: () => Promise<void>) {
      await db.exec(`set role authenticated; set request.jwt.claim.sub='${id(n)}'`);
      try { await run(); } finally { await db.exec("reset role; reset request.jwt.claim.sub"); }
    }
    const value = async <T>(sql: string, params: unknown[] = []) => (await db.query<{ v: T }>(sql, params)).rows[0].v;
    const save = (target: string | null, revision: number | null, details: object = input, assignments: object[] = team) =>
      value<string>("select public.save_task($1,$2,$3,$4) v", [target,revision,details,assignments]);
    const revision = (target: string) => value<number>("select revision::int v from public.tasks where id=$1", [target]);
    const work = (target: string, version: number, status: string) => db.query("select public.set_my_task_work_status($1,$2,$3)",[target,version,status]);
    let personal = "", collaborative = "";
    await actor(1, async () => {
      personal = await save(null,null,{ ...input, scope:"PERSONAL", created_by:id(6), owner_user_id:id(6), owner_member_id:id(106) },[]);
      assert.equal(await value("select owner_user_id v from public.tasks where id=$1",[personal]),id(1));
      assert.equal(await value("select created_by v from public.tasks where id=$1",[personal]),id(1));
      await save(personal,1,{ ...input,scope:"PERSONAL",title:"Privé",status:"DONE" },[]);
      assert.equal(await value("select status v from public.tasks where id=$1",[personal]),"DONE");
      await assert.rejects(save(null,null),/permission denied/);
      await assert.rejects(save(null,null,{ ...input,scope:"PERSONAL" },team),/cannot have collaborators/);
    });
    for (const n of [2,3,4,5,6,7,8,9]) await actor(n,async () => {
      assert.equal(await value("select count(*)::int v from public.tasks where id=$1",[personal]),0);
      assert.equal(await value("select count(*)::int v from public.task_activity where task_id=$1",[personal]),0);
      assert.equal(await value("select count(*)::int v from public.task_reminders where task_id=$1",[personal]),0);
      assert.equal(await value("select public.can_read_task($1) v",[personal]),false);
      await assert.rejects(save(personal,2,{ ...input,scope:"PERSONAL" },[]),/permission denied/);
      await assert.rejects(work(personal,2,"DONE"),/permission denied/);
    });
    // Changing the member/account link alone must not transfer private tasks to an administrator.
    await db.exec(`update public.members set user_id=null where id in ('${id(101)}','${id(106)}'); update public.members set user_id='${id(6)}' where id='${id(101)}'`);
    await actor(6,async () => { assert.equal(await value("select public.can_read_task($1) v",[personal]),false); });
    await db.exec(`update public.members set user_id='${id(1)}' where id='${id(101)}'; update public.members set user_id='${id(6)}' where id='${id(106)}'`);
    await actor(5,async () => {
      collaborative = await save(null,null,{ ...input, created_by:id(6) });
      assert.equal(await value("select created_by v from public.tasks where id=$1",[collaborative]),id(5));
      assert.equal(await value("select count(*)::int v from public.task_members where task_id=$1",[collaborative]),3);
      assert.equal(await value("select count(*)::int v from public.task_activity where task_id=$1",[collaborative]),4);
      for (const assignments of [[], [team[2]], [team[0],team[0]], [team[0],{member_id:id(999),role:"CONTRIBUTOR"}], [team[0],{member_id:id(199),role:"CONTRIBUTOR"}]]) await assert.rejects(save(null,null,input,assignments));
      for (const bad of [{title:" "},{priority:"INVALID"},{status:"INVALID"},{deadline_at:"2026-10-15T12:00Z"},{event_occurrence_date:"2026-10-14"},{timezone:"UTC"}]) await assert.rejects(save(null,null,{...input,...bad}));
      assert.equal(await value("select count(*)::int v from public.tasks"),1, "private tasks remain hidden and failed team creations roll back");
      await save(collaborative,1,{ ...input,title:"Créateur autorisé" });
      await assert.rejects(save(collaborative,2,{ ...input,status:"DONE" }),/Only a lead/);
      await assert.rejects(save(collaborative,1,input),/Task changed/);
      assert.equal(await revision(collaborative),2);
    });
    for (const n of [3,7,8]) await actor(n,async () => {
      assert.equal(await value("select count(*)::int v from public.tasks where id=$1",[collaborative]),0);
      await assert.rejects(save(collaborative,2),/permission denied/);
      await assert.rejects(work(collaborative,2,"DONE"),/permission denied/);
    });
    await actor(9,async () => {
      assert.equal(await value("select count(*)::int v from public.tasks where id=$1",[collaborative]),1);
      await assert.rejects(save(collaborative,2),/permission denied/);
    });
    await actor(2,async () => {
      await assert.rejects(save(collaborative,2),/permission denied/);
      await work(collaborative,2,"DONE");
      assert.equal(await value("select status v from public.tasks where id=$1",[collaborative]),"IN_PROGRESS");
      assert.equal(await value("select count(*)::int v from public.task_members where task_id=$1 and work_status='DONE'",[collaborative]),1);
      await assert.rejects(work(collaborative,2,"TODO"),/Task changed/);
      await work(collaborative,3,"TODO"); await work(collaborative,4,"DONE");
      assert.equal(await value("select actor_id v from public.task_activity where task_id=$1 and action='MEMBER_WORK_REOPENED'",[collaborative]),id(2));
    });
    await actor(1,async () => {
      // A MEMBER who is a LEAD manages the task via the relation, without a global role.
      await save(collaborative,5,{ ...input,status:"DONE" },[team[0],team[1],{...team[2],role:"LEAD"}]);
      assert.equal(await value("select work_status v from public.task_members where task_id=$1 and member_id=$2",[collaborative,id(102)]),"DONE");
      assert.equal(await value("select count(*)::int v from public.task_activity where task_id=$1 and action='MEMBER_ROLE_CHANGED'",[collaborative]),1);
      await save(collaborative,6,{...input,status:"TODO"},[team[0],team[1]]);
    });
    await actor(2,async () => { assert.equal(await value("select public.can_read_task($1) v",[collaborative]),false); });
    await db.exec(`update public.members set active=false where id='${id(104)}'`);
    await actor(6,async () => {
      await save(collaborative,7,input,[team[0],team[1]]); // historical archived lead preserved
      await assert.rejects(save(collaborative,8,{...input,title:"Rollback"},[team[0],{member_id:id(199),role:"CONTRIBUTOR"}]),/archived/);
      assert.equal(await revision(collaborative),8);
      for (const table of ["tasks","task_members","task_activity","task_reminders"]) {
        await assert.rejects(db.exec(`delete from public.${table}`),/permission denied/);
      }
      await assert.rejects(db.exec(`update public.task_members set work_status='DONE'`),/permission denied/);
      await assert.rejects(db.exec(`insert into public.task_activity(task_id,actor_id,action) values('${collaborative}','${id(1)}','TASK_CANCELLED')`),/permission denied/);
      await save(collaborative,8,{...input,status:"CANCELLED"},[team[0],team[1]]);
      assert.equal(await value("select count(*)::int v from public.task_activity where task_id=$1 and action='TASK_CANCELLED'",[collaborative]),1);
      assert.equal(await value("select public.is_site_editor() v"),false);
    });
    await actor(4,async () => {
      assert.equal(await value("select public.can_read_task($1) v",[collaborative]),true);
      await assert.rejects(work(collaborative,9,"DONE"),/Invalid work status/);
      await assert.rejects(save(null,null),/permission denied/);
    });
    // Restore the fixture member before creating new event-linked tasks.
    await db.exec(`update public.members set active=true where id='${id(104)}'`);
    await actor(5,async () => {
      const eventInput={title:"Réunion",description:"",location:"",category:"MEETING",all_day:true,start_date:"2026-10-14",end_date:"2026-10-14",starts_at:null,ends_at:null,timezone:"Europe/Brussels",audience_type:"ALL",frequency:"WEEKLY",recurrence_interval:1,weekdays:[3],until_date:null,occurrence_count:null};
      const event = await value<string>("select public.save_agenda_event(null,null,$1,'{}') v",[eventInput]);
      const task = await save(null,null,{...input,event_id:event,event_occurrence_date:"2026-10-21"});
      await assert.rejects(save(null,null,{...input,event_id:event,event_occurrence_date:"2026-10-22"}),/Invalid event occurrence/);
      await assert.rejects(save(null,null,{...input,event_id:id(999)}),/Event not found/);
      await db.query("select public.cancel_agenda_event($1,null,1)",[event]);
      await save(task,1,{...input,event_id:event,event_occurrence_date:"2026-10-21",title:"Toujours présente"});
      assert.equal(await value("select event_id v from public.tasks where id=$1",[task]),event);
      const simple=await value<string>("select public.save_agenda_event(null,null,$1,'{}') v",[{...eventInput,frequency:"NONE",weekdays:[]}]);
      await save(null,null,{...input,event_id:simple});
      await assert.rejects(save(null,null,{...input,event_id:simple,event_occurrence_date:"2026-10-14"}),/Invalid event occurrence/);
    });
    await db.exec("set role anon");
    await assert.rejects(db.exec("select * from public.tasks"),/permission denied/);
    await assert.rejects(save(null,null),/permission denied/);
    await db.exec("reset role");
    assert.equal(sqlFile("schema.sql").split(tasksMarker)[1]?.split("-- BEGIN APP FINANCE")[0].trim(),sqlFile("migrations/20260923000200_app_tasks.sql").trim());
  } finally { await db.close(); }
});
