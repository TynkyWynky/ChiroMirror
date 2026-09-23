import assert from "node:assert/strict";
import { test } from "node:test";
import { database, fixtureId as id, sqlFile, financeMarker } from "./helpers/database.ts";

test("Comptes PostgreSQL: exact shares, private/treasury RLS, repayments, revisions, corrections and atomicity", async () => {
  const db = await database(true,true);
  try {
    for (let n=1;n<=8;n++) {
      await db.query("insert into auth.users(id,email) values($1,$2)",[id(n),`finance${n}@example.test`]);
      await db.query("insert into public.members(id,user_id,first_name,last_name) values($1,$2,'Test',$3)",[id(100+n),id(n),String(n)]);
    }
    await db.exec(`insert into public.app_user_roles(user_id,role_key) values('${id(1)}','MEMBER'),('${id(2)}','MEMBER'),('${id(3)}','MEMBER'),('${id(4)}','RESPONSIBLE'),('${id(5)}','APP_ADMIN'),('${id(6)}','TREASURER');
      update public.profiles set role='admin' where user_id='${id(7)}';
      insert into public.members(id,first_name,last_name) values('${id(199)}','Sans','Compte');`);
    const value=async <T>(sql:string,args:unknown[]=[]) => (await db.query<{v:T}>(sql,args)).rows[0].v;
    const entity=async (n:number) => value<string>("select id v from public.app_financial_entities where member_id=$1",[id(n)]);
    const one=await entity(101),two=await entity(102),three=await entity(103),unlinked=await entity(199);
    const chiro=await value<string>("select id v from public.app_financial_entities where type='CHIRO'");
    assert.equal(await value("select count(*)::int v from public.app_financial_entities where type='CHIRO'"),1);
    await assert.rejects(db.exec("insert into public.app_financial_entities(type) values('CHIRO')"),/unique/);
    const base={kind:"DIRECT_DEBT",title:"Camp",description:null,amount_cents:"8000",paid_by_entity_id:null,debtor_entity_id:two,creditor_entity_id:one,split_mode:null,expense_date:"2026-09-23",visibility:"PRIVATE"};
    const save=(target:string|null,revision:number|null,details:object=base,shares:object[]=[]) => value<string>("select public.save_app_finance($1,$2,$3,$4) v",[target,revision,details,shares]);
    const rev=(t:string)=>value<number>("select revision::int v from public.app_finance_transactions where id=$1",[t]);
    const obligation=(t:string)=>value<string>("select id v from public.app_finance_obligations where transaction_id=$1 limit 1",[t]);
    const pay=(o:string,r:number,amount:string,extra:object={})=>value<string>("select public.record_app_finance_payment($1,$2,$3) v",[o,r,{amount_cents:amount,payment_date:"2026-09-24",comment:"Test",...extra}]);
    const remaining=(o:string)=>value<string>("select (o.original_amount_cents-coalesce((select sum(a.amount_cents) from public.app_payment_allocations a join public.app_finance_payments p on p.id=a.payment_id where a.obligation_id=o.id and p.status='ACTIVE'),0))::text v from public.app_finance_obligations o where o.id=$1",[o]);
    async function actor(n:number,run:()=>Promise<void>) { await db.exec(`set role authenticated; set request.jwt.claim.sub='${id(n)}'`); try { await run(); } finally { await db.exec("reset role; reset request.jwt.claim.sub"); } }
    let debt="",o="",p1="",p2="",p3="";
    await actor(1,async()=>{
      debt=await save(null,null,{...base,created_by:id(5)}); o=await obligation(debt);
      assert.equal(await value("select created_by v from public.app_finance_transactions where id=$1",[debt]),id(1));
      for(const bad of [{amount_cents:"0"},{amount_cents:"-1"},{amount_cents:1.5},{amount_cents:"1000000000000"},{debtor_entity_id:one},{title:" "},{expense_date:"2026-02-30"},{visibility:"GROUP"}]) await assert.rejects(save(null,null,{...base,...bad}));
      await assert.rejects(save(null,null,{...base,debtor_entity_id:three,creditor_entity_id:two}),/permission denied/);
      await assert.rejects(save(null,null,{...base,visibility:"TREASURY",creditor_entity_id:chiro}),/permission denied/);
      await save(debt,1,{...base,title:"Dette privée"});
      await assert.rejects(save(debt,1),/changed/);
    });
    for(const n of [3,4,5,6,7,8]) await actor(n,async()=>{
      assert.equal(await value("select public.can_read_app_finance($1) v",[debt]),false);
      for(const table of ["app_finance_transactions","app_expense_shares","app_finance_obligations","app_finance_payments","app_payment_allocations","app_finance_activity"]) assert.equal(await value(`select count(*)::int v from public.${table}`),0);
      await assert.rejects(save(debt,2),/permission denied/);
      await assert.rejects(pay(o,2,"100"),/permission denied/);
    });
    // Replace-before-payment produces a new obligation. Never reuse an obsolete ID.
    await actor(2,async()=>{
      o=await obligation(debt);
      assert.equal(await value("select public.can_read_app_finance($1) v",[debt]),true);
      await assert.rejects(save(debt,2),/permission denied/);
      p1=await pay(o,2,"3000",{created_by:id(5),from_entity_id:three,to_entity_id:chiro});
      assert.equal(await remaining(o),"5000");
      assert.equal(await value("select from_entity_id v from public.app_finance_payments where id=$1",[p1]),two);
      assert.equal(await value("select created_by v from public.app_finance_payments where id=$1",[p1]),id(2));
      await assert.rejects(pay(o,2,"4000"),/changed/);
      p2=await pay(o,3,"1000"); assert.equal(await remaining(o),"4000");
      await assert.rejects(pay(o,4,"4001"),/exceeds/);
      await assert.rejects(pay(o,4,"0"));
      p3=await pay(o,4,"4000"); assert.equal(await remaining(o),"0");
      assert.equal(await value("select original_amount_cents::text v from public.app_finance_obligations where id=$1",[o]),"8000");
      assert.equal(await value("select amount_cents::text v from public.app_finance_transactions where id=$1",[debt]),"8000");
    });
    await actor(1,async()=>{
      await assert.rejects(save(debt,5),/Payments exist/);
      await assert.rejects(db.query("select public.cancel_app_finance_transaction($1,5,'Correction')",[debt]),/Active payments/);
      await assert.rejects(db.query("select public.cancel_app_finance_payment($1,5,' ')",[p1]),/reason required/);
      let r=5; for(const payment of [p1,p2,p3]) await db.query("select public.cancel_app_finance_payment($1,$2,'Saisie erronée')",[payment,r++]);
      assert.equal(await remaining(o),"8000");
      await assert.rejects(save(debt,8),/Payments exist/);
      await db.query("select public.cancel_app_finance_transaction($1,8,'Annulation explicite')",[debt]);
      assert.equal(await value("select count(*)::int v from public.app_finance_payments where transaction_id=$1",[debt]),3);
      await assert.rejects(pay(o,9,"100"),/cancelled/);
      for(const table of ["app_financial_entities","app_finance_transactions","app_expense_shares","app_finance_obligations","app_finance_payments","app_payment_allocations","app_finance_activity"]) await assert.rejects(db.exec(`delete from public.${table}`),/permission denied/);
    });
    let expense="";
    const expenseInput={...base,kind:"EXPENSE",paid_by_entity_id:one,debtor_entity_id:null,creditor_entity_id:null,split_mode:"EQUAL",amount_cents:"14782"};
    const participants=[one,two,three,unlinked].map(entity_id=>({entity_id}));
    await actor(1,async()=>{
      expense=await save(null,null,expenseInput,participants);
      const shares=(await db.query<{entity_id:string;amount:string}>("select entity_id,amount_cents::text amount from public.app_expense_shares where transaction_id=$1 order by entity_id",[expense])).rows;
      assert.deepEqual(shares.map(s=>s.amount),["3696","3696","3695","3695"]);
      assert.equal(shares.reduce((sum,s)=>sum+BigInt(s.amount),0n),14782n);
      assert.equal(await value("select count(*)::int v from public.app_finance_obligations where transaction_id=$1",[expense]),3);
      assert.equal(await value("select count(*)::int v from public.app_finance_obligations where debtor_entity_id=creditor_entity_id"),0);
      await assert.rejects(save(null,null,expenseInput,[participants[0],participants[0]]),/Duplicate/);
      await assert.rejects(save(null,null,{...expenseInput,paid_by_entity_id:two},participants),/permission denied/);
      for(const amounts of [["100","100"],["10000","10000"],["-1","14783"],["0","0"],[1.5,"14781"]]) await assert.rejects(save(null,null,{...expenseInput,split_mode:"CUSTOM_AMOUNT"},[{entity_id:one,amount_cents:amounts[0]},{entity_id:two,amount_cents:amounts[1]}]));
      await save(null,null,{...expenseInput,split_mode:"CUSTOM_AMOUNT"},[{entity_id:one,amount_cents:"0"},{entity_id:two,amount_cents:"14782"}]);
      const tiny=await save(null,null,{...expenseInput,amount_cents:"1"},[participants[0],participants[1]]);
      assert.equal(await value("select sum(amount_cents)::text v from public.app_expense_shares where transaction_id=$1",[tiny]),"1");
      assert.equal(await value("select count(*)::int v from public.app_expense_shares where transaction_id=$1 and amount_cents=0",[tiny]),1);
    });
    await db.exec(`update public.members set user_id=null where id='${id(108)}'; update public.members set user_id='${id(8)}' where id='${id(199)}'; insert into public.app_user_roles(user_id,role_key) values('${id(8)}','MEMBER')`);
    await actor(3,async()=>{
      const another=await value<string>("select id v from public.app_finance_obligations where transaction_id=$1 and debtor_entity_id=$2",[expense,two]);
      assert.equal(await value("select public.can_read_app_finance($1) v",[expense]),true);
      await assert.rejects(pay(another,1,"100"),/permission denied/);
      await assert.rejects(db.exec("update public.app_finance_activity set actor_id=null"),/permission denied/);
    });
    await actor(8,async()=>{ assert.equal(await value("select public.can_read_app_finance($1) v",[expense]),true); });
    await db.exec(`update public.members set active=false where id='${id(199)}'`);
    await actor(1,async()=>{
      assert.equal(await value("select public.can_read_app_finance($1) v",[expense]),true);
      await save(expense,1,{...expenseInput,title:"Historique conservé"},participants);
      await assert.rejects(save(null,null,expenseInput,participants),/archived/);
      await assert.rejects(save(null,null,{...base,debtor_entity_id:unlinked}),/archived/);
    });
    let treasury="",reverse="";
    await actor(6,async()=>{
      treasury=await save(null,null,{...base,debtor_entity_id:one,creditor_entity_id:chiro,visibility:"TREASURY"});
      reverse=await save(null,null,{...base,debtor_entity_id:chiro,creditor_entity_id:one,visibility:"TREASURY",amount_cents:"4250"});
      await assert.rejects(save(null,null,base),/permission denied/);
      await save(null,null,{...expenseInput,visibility:"TREASURY",paid_by_entity_id:chiro},[{entity_id:chiro},{entity_id:one}]);
    });
    await actor(1,async()=>{
      assert.equal(await value("select public.can_read_app_finance($1) v",[treasury]),true);
      assert.equal(await value("select public.can_read_app_finance($1) v",[reverse]),true);
      await assert.rejects(pay(await obligation(treasury),1,"100"),/permission denied/);
    });
    for(const n of [2,4,5,7]) await actor(n,async()=>{ assert.equal(await value("select public.can_read_app_finance($1) v",[treasury]),false); });
    await actor(6,async()=>{
      const owed=await obligation(treasury);
      // Simultaneous submissions with the same observed version: at most one succeeds.
      const results=await Promise.allSettled([pay(owed,1,"3000"),pay(owed,1,"6000")]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(await rev(treasury),2);
      const left=await remaining(owed); assert.ok(BigInt(left)>=0n);
      await assert.rejects(pay(owed,2,(BigInt(left)+1n).toString()),/exceeds/);
    });
    // Fail after expense and shares are written; the whole RPC must roll back.
    await db.exec(`create function public.fixture_reject_obligation() returns trigger language plpgsql as $$ begin raise exception 'late obligation failure'; end $$;
      create trigger fixture_reject_obligation before insert on public.app_finance_obligations for each row execute function public.fixture_reject_obligation();`);
    const counts=async()=> (await db.query("select (select count(*) from public.app_finance_transactions)::int tx,(select count(*) from public.app_expense_shares)::int shares,(select count(*) from public.app_finance_activity)::int audit")).rows[0];
    const before=await counts();
    await actor(1,async()=>{ await assert.rejects(save(null,null,expenseInput,[participants[0],participants[1]]),/late obligation failure/); });
    assert.deepEqual(await counts(),before);
    await db.exec("drop trigger fixture_reject_obligation on public.app_finance_obligations");
    // Payment and allocation must also roll back if writing the audit fails.
    await db.exec(`create function public.fixture_reject_finance_audit() returns trigger language plpgsql as $$ begin if new.action='PAYMENT_RECORDED' then raise exception 'late audit failure'; end if; return new; end $$;
      create trigger fixture_reject_finance_audit before insert on public.app_finance_activity for each row execute function public.fixture_reject_finance_audit();`);
    await actor(6,async()=>{
      const owed=await obligation(treasury),left=await remaining(owed);
      await assert.rejects(pay(owed,2,"1"),/late audit failure/);
      assert.equal(await rev(treasury),2); assert.equal(await remaining(owed),left);
    });
    await db.exec("set role anon");
    await assert.rejects(db.exec("select * from public.app_finance_transactions"),/permission denied/);
    await assert.rejects(save(null,null),/permission denied/);
    await db.exec("reset role");
    for (const n of [3,4,5,6,7,8]) await actor(n,async()=>{
      const snapshot=await value<{transactions:{id:string}[];payments:{transaction_id:string}[]}|null>("select public.get_app_finance_snapshot() v");
      assert.ok(!snapshot?.transactions.some(t=>t.id===debt));
      assert.ok(!snapshot?.payments.some(p=>p.transaction_id===debt));
      assert.equal(await value("select count(*)::int v from public.app_finance_activity where transaction_id=$1",[debt]),0);
      assert.equal(await value("select count(*)::int v from public.app_payment_allocations where payment_id=$1",[p1]),0);
    });
    assert.equal(sqlFile("schema.sql").split(financeMarker)[1]?.split("-- BEGIN APP NOTIFICATIONS")[0].trim(),sqlFile("migrations/20260923000300_app_finance.sql").trim());
  } finally { await db.close(); }
});
