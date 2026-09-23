import assert from "node:assert/strict";
import { test } from "node:test";
import { database, fixtureId as id, sqlFile, notificationsMarker } from "./helpers/database.ts";
import { planSource, type PlanSource } from "../src/server/notifications/planner.ts";
import { runNotificationTick, type Delivery } from "../src/server/notifications/dispatcher.ts";

async function fixture() {
  const db = await database(true,true,true);
  for (let n=1;n<=6;n++) {
    await db.query("insert into auth.users(id,email) values($1,$2)",[id(n),`notifications${n}@example.test`]);
    if(n<6) await db.query("insert into public.app_user_roles(user_id,role_key) values($1,$2)",[id(n),n===3?"RESPONSIBLE":n===4?"APP_ADMIN":"MEMBER"]);
    await db.query("insert into public.members(id,user_id,first_name,last_name,active) values($1,$2,'Test',$3,$4)",[id(n+100),id(n),String(n),n!==5]);
  }
  const value = async <T=any>(sql:string, args:unknown[]=[]) => (await db.query<{v:T}>(sql,args)).rows[0]?.v;
  const actor = async <T>(n:number,run:()=>Promise<T>) => { await db.exec(`set role authenticated; set request.jwt.claim.sub='${id(n)}'`); try{return await run();}finally{await db.exec("reset role; reset request.jwt.claim.sub");} };
  const worker = { async rpc(name:string,args:object={}) {
    assert.ok(["claim_notification_sources","commit_notification_plan","fail_notification_plan","materialize_notification_jobs","claim_notification_deliveries","authorize_notification_delivery","finish_notification_delivery","cleanup_notifications"].includes(name));
    try { const data=await db.transaction(async tx=> { await tx.exec("set local role service_role"); const entries=Object.entries(args); return (await tx.query<{v:unknown}>(`select public.${name}(${entries.map(([key],i)=>`${key} => $${i+1}`).join(',')}) v`,entries.map(([,v])=>v))).rows[0].v; }); return {data,error:null}; }
    catch(error){return {data:null,error};}
  } };
  const server = async <T=any>(name:string,args:object={}) => { const r=await worker.rpc(name,args);if(r.error) throw r.error;return r.data as T; };
  const prefs=(n:number,details:object={},categories:object[]=[])=>actor(n,()=>value("select public.save_notification_preferences($1,$2) v",[{push_enabled:false,event_notifications_enabled:true,task_notifications_enabled:true,push_details:false,...details},categories]));
  const subscribe=(n:number,label:string)=>actor(n,()=>value<string>("select public.register_push_subscription($1) v",[{endpoint:`https://fcm.googleapis.com/fcm/send/${n}-${label}`,p256dh:'A'.repeat(87),auth:'B'.repeat(22),device_label:label}]));
  const now = await value<string>("select now()::text v");
  const day = new Date(Date.parse(now)+86400000).toISOString().slice(0,10);
  const details = {title:"Activité",description:"",location:"Locaux",category:"ACTIVITY",all_day:false,start_date:null,end_date:null,starts_at:new Date(Date.parse(now)+3600000).toISOString(),ends_at:new Date(Date.parse(now)+7200000).toISOString(),timezone:"Europe/Brussels",audience_type:"ALL",frequency:"NONE",recurrence_interval:1,weekdays:[],until_date:null,occurrence_count:null};
  const event=()=>actor(3,()=>value<string>("select public.save_agenda_event_with_reminders(null,null,$1,'{}',$2) v",[details,[{kind:"OFFSET",offset_minutes:61}]]));
  const task=(scope="TEAM")=>actor(3,()=>value<string>("select public.save_task_with_reminders(null,null,$1,$2,$3) v",[{scope,title:"Commander",description:"",status:"TODO",priority:"NORMAL",deadline_date:day,deadline_at:null,timezone:"Europe/Brussels",event_id:null,event_occurrence_date:null},scope==="TEAM"?[{member_id:id(103),role:"LEAD"},{member_id:id(101),role:"CONTRIBUTOR"},{member_id:id(102),role:"CONTRIBUTOR"}]:[],[{kind:"LOCAL_TIME",days_before:1,local_time:"19:00"}]]));
  return {db,value,actor,worker,server,prefs,subscribe,event,task,now,details};
}
test("Notifications migration mirrors bootstrap",()=>assert.equal(sqlFile("schema.sql").split(notificationsMarker)[1].trim(),sqlFile("migrations/20260923000400_app_notifications.sql").trim()));

test("Notifications PostgreSQL owner privacy, protected RPCs, self-only subscriptions and atomic reminder saves",async()=>{
  const f=await fixture(); const {db,actor,value,prefs,subscribe}=f;
  try {
    await prefs(1,{push_enabled:true,user_id:id(2)}); const sub=await subscribe(1,"PC");
    await db.query("insert into public.notifications(user_id,kind,title,body,source_type,source_id) values($1,'SYSTEM','Privé','Texte','SYSTEM',$1)",[id(1)]);
    for(const n of [2,4,6]) await actor(n,async()=>{
      for(const table of ["notifications","notification_preferences","notification_category_preferences","push_subscriptions"]) assert.equal(await value(`select count(*)::int v from public.${table}`),0);
      for(const table of ["notification_jobs","notification_deliveries","notification_rebuild_queue"]) await assert.rejects(value(`select count(*) v from public.${table}`),/permission denied/);
      await assert.rejects(value("select public.claim_notification_sources() v"),/permission denied/);
      await assert.rejects(value("select public.notification_dirty('EVENT',$1) v",[id(999)]),/permission denied/);
      await assert.rejects(value("select public.enqueue_my_notification_test($1) v",[sub]),/permission denied/);
      if(n===6) await assert.rejects(value("select public.mark_notifications_read(null) v"),/permission denied/); else await value("select public.mark_notifications_read(null) v");
    });
    assert.equal(await value("select count(*)::int v from public.notifications where read_at is null"),1);
    await actor(1,async()=>{
      assert.equal(await value("select count(*)::int v from public.notifications"),1);
      await assert.rejects(db.query("update public.notification_preferences set user_id=$1",[id(2)]),/permission denied/);
      await assert.rejects(value("select public.register_push_subscription($1) v",[{endpoint:"https://127.0.0.1/private",p256dh:'A'.repeat(87),auth:'B'.repeat(22)}]));
      await value("select public.enqueue_my_notification_test($1) v",[sub]);
      await assert.rejects(value("select public.enqueue_my_notification_test($1) v",[sub]),/Wait one minute/);
      await value("select public.mark_notifications_read(null) v");
    });
    assert.equal(await value("select count(*)::int v from public.notifications where read_at is null"),0);
    const event=await f.event();
    await actor(3,()=>assert.rejects(value("select public.save_agenda_event_with_reminders($1,1,$2,'{}',$3) v",[event,{...f.details,title:"Rollback"},[{kind:"OFFSET",offset_minutes:-1}]])));
    assert.equal(await value("select title v from public.events where id=$1",[event]),"Activité");
    assert.equal(await value("select revision::int v from public.events where id=$1",[event]),1);
  }finally{await db.close();}
});

test("Notifications worker twice: one internal reminder per recipient, multidevice isolation, safe 410 and retries",async()=>{
  const f=await fixture(); const {db,value,prefs,subscribe,worker,now}=f;
  try {
    await prefs(1,{push_enabled:true}); const expired=await subscribe(1,"expired"),live=await subscribe(1,"live");
    await prefs(2,{push_enabled:false}); await subscribe(2,"disabled");
    await prefs(4,{event_notifications_enabled:false});
    await f.event(); let sends:Delivery[]=[];
    const sender=async(d:Delivery)=>{sends.push(d); if(d.subscription_id===expired)throw{statusCode:410,body:"sensitive secret"};if(d.subscription_id===live&&sends.filter(x=>x.subscription_id===live).length===1)throw{statusCode:503};};
    const first=await runNotificationTick(worker,sender,now); assert.equal(first.internal,3); assert.equal(sends.length,2);
    assert.ok(sends.every(d=>!d.payload.body.includes("Locaux"))); assert.equal(await value("select active v from public.push_subscriptions where id=$1",[expired]),false);
    const retry=await value<any>("select to_jsonb(d) v from public.notification_deliveries d where subscription_id=$1",[live]); assert.equal(retry.status,"PENDING");assert.equal(retry.attempts,1);
    await prefs(2,{push_enabled:false,event_notifications_enabled:false});
    assert.equal(await value("select status v from public.notification_deliveries where subscription_id=$1",[live]),"PENDING","another user's preference must not cancel this device's retry");
    assert.ok(Date.parse(retry.next_attempt_at)>Date.parse(now)+55000);
    await runNotificationTick(worker,sender,now); assert.equal(sends.length,2); assert.equal(await value("select count(*)::int v from public.notifications"),3);
    await db.exec("update public.notification_deliveries set next_attempt_at=now() where status='PENDING'");
    await runNotificationTick(worker,sender,now);assert.equal(sends.length,3);assert.equal(sends[2].id,sends.find(d=>d.subscription_id===live)!.id);
    assert.equal(await value("select status v from public.notification_deliveries where subscription_id=$1",[live]),"SENT");
    assert.equal(await value("select count(*)::int v from public.notification_jobs"),3);assert.equal(await value("select count(*)::int v from public.notifications"),3);
    assert.equal(await value("select count(*)::int v from public.notification_deliveries"),2);
  }finally{await db.close();}
});

test("Notifications claims, stale leases, bounded retries and final authorization",async()=>{
  const f=await fixture();const{db,value,prefs,subscribe,server}=f;
  try{
    await prefs(1,{push_enabled:true});await subscribe(1,"PC"); await f.event();
    await runNotificationTick(f.worker,null,f.now);
    const [a,b]=await Promise.all([server<Delivery[]>("claim_notification_deliveries"),server<Delivery[]>("claim_notification_deliveries")]);assert.equal(a.length+b.length,1);
    let delivery=[...a,...b][0]; const stale=delivery.token;
    await db.exec("update public.notification_deliveries set claimed_at=now()-interval '2 minutes'");
    delivery=(await server<Delivery[]>("claim_notification_deliveries"))[0];assert.notEqual(delivery.token,stale);
    await server("finish_notification_delivery",{target_id:delivery.id,token:stale,result_code:"OK"});assert.equal(await value("select status v from public.notification_deliveries"),"PROCESSING");
    await server("finish_notification_delivery",{target_id:delivery.id,token:delivery.token,result_code:"TEMPORARY"});
    assert.equal(await value("select round(extract(epoch from next_attempt_at-now()))::int v from public.notification_deliveries"),300);
    for(const wait of [900,0]){
      await db.exec("update public.notification_deliveries set next_attempt_at=now()");delivery=(await server<Delivery[]>("claim_notification_deliveries"))[0];
      await server("finish_notification_delivery",{target_id:delivery.id,token:delivery.token,result_code:"TEMPORARY"});
      assert.equal(await value("select status v from public.notification_deliveries"),wait?"PENDING":"FAILED");
      if(wait)assert.equal(await value("select round(extract(epoch from next_attempt_at-now()))::int v from public.notification_deliveries"),wait);
    }
    assert.deepEqual(await server("claim_notification_deliveries"),[]);
    await f.actor(1,()=>value("select public.enqueue_my_notification_test((select id from public.push_subscriptions limit 1)) v"));
    await server("materialize_notification_jobs");delivery=(await server<Delivery[]>("claim_notification_deliveries"))[0];
    await prefs(1,{push_enabled:false});assert.equal(await server("authorize_notification_delivery",{target_id:delivery.id,token:delivery.token}),false);
  }finally{await db.close();}
});

test("Notifications dirty revisions reject stale plans; task DONE, individual DONE, deadline removal, roles and member archive",async()=>{
  const f=await fixture();const{db,value,server}=f;
  try{
    const task=await f.task(), personal=await f.task("PERSONAL");
    let sources=await server<PlanSource[]>("claim_notification_sources");
    assert.deepEqual(sources.find(s=>s.source_id===task)!.recipients.map(r=>r.user_id).sort(),[id(1),id(2),id(3)]);
    assert.deepEqual(sources.find(s=>s.source_id===personal)!.recipients.map(r=>r.user_id),[id(3)]);
    const claimed=sources.find(s=>s.source_id===task)!;
    await db.query("update public.task_members set work_status='DONE' where task_id=$1 and member_id=$2",[task,id(101)]);
    assert.equal(await server("commit_notification_plan",{kind:"TASK",source:task,expected_revision:claimed.revision,token:claimed.claim_token,planned:[]}),false);
    await db.exec("update public.notification_rebuild_queue set claimed_at=null,claim_token=null");
    sources=await server<PlanSource[]>("claim_notification_sources"); assert.deepEqual(sources.find(s=>s.source_id===task)!.recipients.map(r=>r.user_id).sort(),[id(2),id(3)]);
    for(const s of sources)await server("commit_notification_plan",{kind:s.source_type,source:s.source_id,expected_revision:s.revision,token:s.claim_token,planned:planSource(s,f.now)});
    await db.query("update public.tasks set status='DONE' where id=$1",[task]);
    assert.equal(await value("select count(*)::int v from public.notification_jobs where source_id=$1 and status='PENDING'",[task]),0);
    await db.query("update public.tasks set deadline_date=null where id=$1",[personal]);assert.equal(await value("select public.notification_recipient_allowed('TASK',$1,$2) v",[personal,id(3)]),false);
    const event=await f.event();await db.query("update public.members set active=false where user_id=$1",[id(2)]);
    await db.query("delete from public.app_user_roles where user_id=$1",[id(1)]);
    sources=await server<PlanSource[]>("claim_notification_sources");assert.deepEqual(sources.find(s=>s.source_id===event)!.recipients.map(r=>r.user_id).sort(),[id(3),id(4)]);
  }finally{await db.close();}
});

test("Notifications selected audience, category preferences, moved/cancelled occurrence and expired 404",async()=>{
 const f=await fixture();const{db,value,actor,server}=f;
 try{
  const starts=new Date(Date.parse(f.now)+3*86400000).toISOString(),ends=new Date(Date.parse(starts)+3600000).toISOString();
  const original=(await import("../src/features/app/events/dates.ts")).instantToLocal(starts).slice(0,10);
  const details={...f.details,starts_at:starts,ends_at:ends,frequency:"WEEKLY",weekdays:[new Date(original+'T12:00Z').getUTCDay()||7],audience_type:"SELECTED"};
  const event=await actor(3,()=>value<string>("select public.save_agenda_event_with_reminders(null,null,$1,$2,$3) v",[details,[id(101),id(102)],[{kind:"LOCAL_TIME",days_before:1,local_time:"19:00"}]]));
  await f.prefs(2,{},[{category_key:"ACTIVITY",enabled:false}]);
  const plan=async()=>{
   await db.exec("update public.notification_rebuild_queue set claimed_at=null,claim_token=null");
   const sources=await server<PlanSource[]>("claim_notification_sources");const s=sources.find(s=>s.source_id===event)!;assert.ok(s);
   const planned=planSource(s,f.now);await server("commit_notification_plan",{kind:"EVENT",source:event,expected_revision:s.revision,token:s.claim_token,planned});return planned;
  };
  const first=await plan();assert.ok(first.length);assert.ok(first.every(j=>j.user_id===id(1)));
  const old=await value<string>("select id v from public.notification_jobs where source_id=$1 and source_occurrence_key=$2 and user_id=$3",[event,original,id(1)]);
  await actor(3,()=>value("select public.save_agenda_occurrence($1,$2,1,$3) v",[event,original,{...details,starts_at:new Date(Date.parse(starts)+86400000).toISOString(),ends_at:new Date(Date.parse(ends)+86400000).toISOString(),category:"CAMP"}]));
  assert.equal(await value("select status v from public.notification_jobs where id=$1",[old]),"CANCELLED");
  const moved=await plan();assert.equal(moved.filter(j=>j.occurrence_key===original).length,2,"override category enables user 2 for this occurrence only");
  assert.notEqual(moved.find(j=>j.occurrence_key===original)!.due_at,first.find(j=>j.occurrence_key===original)!.due_at);
  await actor(3,()=>value("select public.cancel_agenda_event($1,$2,2) v",[event,original]));assert.ok(!(await plan()).some(j=>j.occurrence_key===original));
  await actor(3,()=>value("select public.cancel_agenda_event($1,null,3) v",[event]));assert.deepEqual(await plan(),[]);
  await f.prefs(1,{push_enabled:true});const subscription=await f.subscribe(1,"gone");
  await actor(1,()=>value("select public.enqueue_my_notification_test($1) v",[subscription]));
  await runNotificationTick(f.worker,async()=>{throw{statusCode:404};},f.now);
  assert.equal(await value("select active v from public.push_subscriptions where id=$1",[subscription]),false);
  assert.equal(await value("select status v from public.notification_deliveries where subscription_id=$1",[subscription]),"FAILED");
 }finally{await db.close();}
});
