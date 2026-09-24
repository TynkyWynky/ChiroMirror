import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { database, fixtureId as id } from "../tests/helpers/database.ts";
import { formatMoney } from "../src/features/app/finance/money.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const db = await database(true,true);
let server,browser;
try {
  for(const [n,first,role] of [[1,"Pierre","MEMBER"],[2,"Thomas","MEMBER"],[3,"Lucas","MEMBER"],[5,"Admin","APP_ADMIN"],[6,"Penningmeester","TREASURER"]]) {
    await db.query("insert into auth.users(id,email) values($1,$2)",[id(n),`finance${n}@example.test`]);
    await db.query("insert into public.app_user_roles(user_id,role_key) values($1,$2)",[id(n),role]);
    await db.query("insert into public.members(id,user_id,first_name,last_name) values($1,$2,$3,'Exemple')",[id(100+n),id(n),first]);
  }
  await db.query("insert into public.members(id,first_name,last_name,active) values($1,'Arthur','Sans compte',true),($2,'Ancien','Lid',false)",[id(104),id(199)]);
  const entities=(await db.query("select id,member_id,type from public.app_financial_entities")).rows;
  const entity=n=>entities.find(e=>e.member_id===id(100+n)).id;
  const chiro=entities.find(e=>e.type==="CHIRO").id;
  server=await createServer({configFile:false,root:`${root}/tests/fixtures/finance`,esbuild:{jsx:"automatic",jsxImportSource:"preact"},server:{host:"127.0.0.1",port:0,fs:{allow:[root]}},
    plugins:[{name:"ephemeral-finance-db",configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
      if(!req.url?.startsWith("/fixture-api")) return next();
      res.setHeader("Content-Type","application/json");
      try {
        const url=new URL(req.url,"http://127.0.0.1"),actor=Number(url.searchParams.get("actor")); assert.ok([1,2,3,5,6].includes(actor));
        const data=await db.transaction(async tx=>{
          await tx.exec(`set local role authenticated; set local request.jwt.claim.sub='${id(actor)}'`);
          if(url.searchParams.has("access")) return (await tx.query("select public.get_my_app_access() data")).rows[0].data;
          if(req.method==="GET") {
            assert.equal(url.searchParams.get("table"),"app_finance_activity");
            return (await tx.query("select coalesce(jsonb_agg(to_jsonb(a)),'[]') data from (select * from public.app_finance_activity where transaction_id=$1 order by created_at desc,id limit $2) a",[url.searchParams.get("transaction"),Number(url.searchParams.get("limit"))])).rows[0].data;
          }
          let body="";for await(const chunk of req) body+=chunk;
          const {name,args}=JSON.parse(body);
          const calls={
            get_app_finance_snapshot:["select public.get_app_finance_snapshot() data",[]],
            save_app_finance:["select public.save_app_finance($1,$2,$3,$4) data",[args.target_id,args.expected_revision,args.details,args.shares]],
            record_app_finance_payment:["select public.record_app_finance_payment($1,$2,$3) data",[args.obligation_id,args.expected_revision,args.details]],
            cancel_app_finance_payment:["select public.cancel_app_finance_payment($1,$2,$3) data",[args.target_id,args.expected_revision,args.reason]],
            cancel_app_finance_transaction:["select public.cancel_app_finance_transaction($1,$2,$3) data",[args.target_id,args.expected_revision,args.reason]]
          };
          assert.ok(Object.hasOwn(calls,name)); const [sql,values]=calls[name];return (await tx.query(sql,values)).rows[0].data;
        });
        res.end(JSON.stringify({data,error:null}));
      } catch(error){res.end(JSON.stringify({data:null,error:{code:error.code,message:error.message,details:error.detail}}));}
    });}}]});
  await server.listen(); const base=`http://127.0.0.1:${server.httpServer.address().port}`;
  const executablePath=process.env.FINANCE_BROWSER_PATH??process.env.TASKS_BROWSER_PATH??["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","/usr/bin/chromium","/usr/bin/google-chrome"].find(existsSync);
  if(!executablePath) throw new Error("Set FINANCE_BROWSER_PATH to an installed Chromium/Edge executable.");
  browser=await chromium.launch({executablePath,headless:true}); const errors=[];
  async function pageFor(actor,mobile=false){const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1280,height:1000},isMobile:mobile,hasTouch:mobile});page.setDefaultTimeout(20000);page.on("pageerror",e=>errors.push(e.message));await page.clock.setFixedTime(new Date("2026-09-23T10:00:00Z"));await page.goto(`${base}/?actor=${actor}`);await page.getByTestId("payable").waitFor();return page;}
  const page=await pageFor(1);
  await page.getByRole("button",{name:"+ Nieuwe schuld",exact:true}).click();
  await page.getByLabel("Reden *",{exact:true}).fill("Camp privé");
  await page.getByLabel("Totaalbedrag (€) *",{exact:true}).fill("80,00");
  await page.getByLabel("Wie is geld verschuldigd?",{exact:true}).selectOption(entity(2));
  await page.getByLabel("Aan wie?",{exact:true}).selectOption(entity(1));
  assert.equal(await page.getByRole("option",{name:"Ancien Lid (gearchiveerd)"}).count(),0);
  await page.getByRole("button",{name:"Opslaan",exact:true}).click();
  await page.getByRole("button",{name:"Camp privé",exact:true}).waitFor();
  assert.equal(await page.getByTestId("receivable").innerText(),formatMoney(8000n));
  await page.getByRole("button",{name:"Camp privé",exact:true}).click();
  await page.getByRole("button",{name:"Deze schuld terugbetalen",exact:true}).click();
  await page.getByLabel("Bedrag van de terugbetaling (€) *",{exact:true}).fill("80,01");
  await page.getByRole("button",{name:"Terugbetaling opslaan",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"hoger dan het resterende saldo"}).waitFor();
  await page.getByLabel("Bedrag van de terugbetaling (€) *",{exact:true}).fill("30");
  await page.getByRole("button",{name:"Terugbetaling opslaan",exact:true}).click();
  await page.getByText("Terugbetaling opgeslagen.",{exact:true}).waitFor();
  // Keep this view open at revision 2 to test a concurrent change from Thomas's phone.
  const mobile=await pageFor(2,true);
  assert.equal(await mobile.getByTestId("payable").innerText(),formatMoney(5000n));
  await mobile.getByRole("button",{name:"Camp privé",exact:true}).click();
  assert.equal(await mobile.getByRole("button",{name:"Bewerken",exact:true}).count(),0);
  await mobile.getByRole("button",{name:"Deze schuld terugbetalen",exact:true}).click();
  await mobile.getByLabel("Bedrag van de terugbetaling (€) *",{exact:true}).fill("10");
  await mobile.getByRole("button",{name:"Terugbetaling opslaan",exact:true}).click();
  await mobile.getByText("Terugbetaling opgeslagen.",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Deze schuld terugbetalen",exact:true}).click();
  await page.getByLabel("Bedrag van de terugbetaling (€) *",{exact:true}).fill("40");
  await page.getByRole("button",{name:"Terugbetaling opslaan",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"Deze transactie is gewijzigd"}).waitFor();
  await page.getByRole("button",{name:"Sluiten zonder op te slaan",exact:true}).click();
  await page.getByRole("button",{name:"Rekeningen verversen",exact:true}).click();
  await page.getByTestId("receivable").filter({hasText:"40,00"}).waitFor();
  await mobile.getByRole("button",{name:"Deze schuld terugbetalen",exact:true}).click();
  await mobile.getByRole("button",{name:"Volledig resterend bedrag",exact:true}).click();
  await mobile.getByRole("button",{name:"Terugbetaling opslaan",exact:true}).click();
  await mobile.getByText("Terugbetaling opgeslagen.",{exact:true}).waitFor();
  await mobile.getByRole("button",{name:"Details sluiten",exact:true}).click();
  await mobile.getByRole("button",{name:"Geschiedenis",exact:true}).click();
  await mobile.getByLabel("Transacties filteren",{exact:true}).selectOption("SETTLED");
  await mobile.getByRole("button",{name:"Camp privé",exact:true}).waitFor();
  assert.equal(await mobile.getByTestId("payable").innerText(),formatMoney(0n));
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const artifacts=`${root}/.test-artifacts`;mkdirSync(artifacts,{recursive:true});
  await mobile.screenshot({path:`${artifacts}/finance-mobile.png`,fullPage:true});
  await mobile.getByRole("button",{name:"Camp privé",exact:true}).click();
  await mobile.locator(".finance-obligation").filter({hasText:"40,00"}).getByRole("button",{name:"Deze terugbetaling annuleren",exact:true}).click();
  await mobile.getByLabel("Reden voor annulering *",{exact:true}).fill("Correction du paiement saisi");
  await mobile.getByRole("button",{name:"Annulering bevestigen",exact:true}).click();
  await mobile.getByText("Annulering opgeslagen; geschiedenis bewaard.",{exact:true}).waitFor();
  await mobile.getByRole("button",{name:"Deze schuld terugbetalen",exact:true}).click();
  await mobile.getByRole("button",{name:"Volledig resterend bedrag",exact:true}).click();
  await mobile.getByRole("button",{name:"Terugbetaling opslaan",exact:true}).click();
  await mobile.getByText("Terugbetaling opgeslagen.",{exact:true}).waitFor();
  assert.equal((await db.query("select count(*)::int n from public.app_finance_payments where status='CANCELLED'")).rows[0].n,1);

  await page.getByRole("button",{name:"+ Nieuwe uitgave",exact:true}).click();
  await page.getByLabel("Reden *",{exact:true}).fill("Souper partagé");
  await page.getByLabel("Totaalbedrag (€) *",{exact:true}).fill("147,82");
  for(const name of ["Pierre Exemple","Thomas Exemple","Lucas Exemple","Arthur Sans compte"]) await page.getByRole("checkbox",{name,exact:true}).check();
  await page.getByRole("button",{name:"Opslaan",exact:true}).click();
  await page.getByRole("button",{name:"Souper partagé",exact:true}).click();
  await page.getByRole("heading",{name:"Aandelen van de uitgave",exact:true}).waitFor();
  const sum=(await db.query("select sum(s.amount_cents)::text amount from public.app_expense_shares s join public.app_finance_transactions t on t.id=s.transaction_id where t.title='Souper partagé'")).rows[0].amount;
  assert.equal(sum,"14782");
  assert.equal(await page.getByRole("button",{name:"Deze schuld terugbetalen",exact:true}).count(),3);
  await page.screenshot({path:`${artifacts}/finance-desktop.png`,fullPage:true});
  await page.getByRole("button",{name:"Transactie annuleren",exact:true}).click();
  await page.getByLabel("Reden voor annulering *",{exact:true}).fill("Exemple à remplacer");
  await page.getByRole("button",{name:"Annulering bevestigen",exact:true}).click();
  await page.getByText("Annulering opgeslagen; geschiedenis bewaard.",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Details sluiten",exact:true}).click();
  await page.getByRole("button",{name:"+ Nieuwe uitgave",exact:true}).click();
  await page.getByLabel("Reden *",{exact:true}).fill("Courses personnalisées");
  await page.getByLabel("Totaalbedrag (€) *",{exact:true}).fill("100");
  await page.getByLabel("Verdeling",{exact:true}).selectOption("CUSTOM_AMOUNT");
  for(const [name,amount] of [["Pierre Exemple","20"],["Thomas Exemple","30"],["Lucas Exemple","40"]]) {await page.getByRole("checkbox",{name,exact:true}).check();await page.getByLabel(`Aandeel van ${name} (€)`,{exact:true}).fill(amount);}
  await page.getByRole("button",{name:"Opslaan",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"som van de aandelen"}).waitFor();
  await page.getByLabel("Aandeel van Lucas Exemple (€)",{exact:true}).fill("50");
  await page.getByRole("button",{name:"Opslaan",exact:true}).click();
  await page.getByRole("button",{name:"Courses personnalisées",exact:true}).waitFor();
  assert.equal(await page.getByTestId("receivable").innerText(),formatMoney(8000n));

  const treasury=await pageFor(6);
  await treasury.getByRole("button",{name:"+ Nieuwe schuld",exact:true}).click();
  await treasury.getByLabel("Zichtbaarheid",{exact:true}).selectOption("TREASURY");
  await treasury.getByLabel("Reden *",{exact:true}).fill("Solde camp Chiro");
  await treasury.getByLabel("Totaalbedrag (€) *",{exact:true}).fill("80");
  await treasury.getByLabel("Wie is geld verschuldigd?",{exact:true}).selectOption(entity(2));
  await treasury.getByLabel("Aan wie?",{exact:true}).selectOption(chiro);
  await treasury.getByRole("button",{name:"Opslaan",exact:true}).click();
  await treasury.getByText("Transactie opgeslagen.",{exact:true}).waitFor();
  await treasury.getByRole("button",{name:"Chirokas",exact:true}).click();
  await treasury.getByRole("button",{name:"Solde camp Chiro",exact:true}).click();
  await treasury.getByRole("button",{name:"Deze schuld terugbetalen",exact:true}).click();
  await treasury.getByLabel("Bedrag van de terugbetaling (€) *",{exact:true}).fill("30");
  await treasury.getByRole("button",{name:"Terugbetaling opslaan",exact:true}).click();
  await treasury.getByText("Terugbetaling opgeslagen.",{exact:true}).waitFor();
  await mobile.goto(`${base}/?actor=2`);
  await mobile.getByRole("button",{name:"Solde camp Chiro",exact:true}).click();
  await mobile.getByRole("heading",{name:"Schulden",exact:true}).waitFor();
  assert.equal(await mobile.getByRole("button",{name:/Deze schuld terugbetalen|Deze terugbetaling annuleren|Bewerken/}).count(),0);
  assert.match(await mobile.locator(".finance-detail").innerText(),/50,00/);
  const admin=await pageFor(5);
  assert.equal(await admin.getByRole("button",{name:"Chirokas",exact:true}).count(),0);
  const snapshot=await admin.evaluate(async()=>(await(await fetch("/fixture-api?actor=5",{method:"POST",body:JSON.stringify({name:"get_app_finance_snapshot",args:{}})})).json()).data);
  assert.equal(snapshot.transactions.length,0);assert.equal(snapshot.payments.length,0);
  await page.goto(`${base}/?actor=1&summary`);
  await page.getByText(/Te ontvangen:/).waitFor();
  assert.match(await page.locator("main").innerText(),/80,00/);
  await page.getByRole("button",{name:"Mijn rekeningen openen",exact:true}).click();
  await page.getByRole("button",{name:"Courses personnalisées",exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log("Rekeningen browser checks passed: desktop/mobile, private debt, partial/full payments, stale revision, equal/custom expense, cancellation, balances/history, treasury permissions, admin privacy and dashboard. Screenshots: .test-artifacts/");
} finally {await browser?.close();await server?.close();await db.close();}
