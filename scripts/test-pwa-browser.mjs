import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { database, fixtureId as id } from '../tests/helpers/database.ts';
import { appManifest, offlineHtml } from '../src/server/pwa.ts';
const root=fileURLToPath(new URL('..',import.meta.url)),db=await database(true,true,true),scope='/fixture-app/';
let server,browser,debugPage,release='fixture-v1',updates=0;
try {
 await db.exec('grant select on public.profiles,public.site_settings,public.page_content,public.groups,public.contact_sections,public.songs,public.posts,public.contact_messages,public.finance_transactions to authenticated'); // Supabase legacy default grants; RLS still applies.
 for(const [n,name] of [[1,'Mehmet'],[2,'Thomas']]){
  await db.query("insert into auth.users(id,email) values($1,$2)",[id(n),`${name.toLowerCase()}@example.test`]);
  await db.query("insert into public.members(id,user_id,first_name,last_name) values($1,$2,$3,'Fixture')",[id(100+n),id(n),name]);
  for(const role of ['MEMBER','RESPONSIBLE','APP_ADMIN','TREASURER'])await db.query('insert into public.app_user_roles(user_id,role_key) values($1,$2)',[id(n),role]);
 }
 await db.query("update public.profiles set role='admin' where user_id=$1",[id(1)]);
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${id(1)}'`);
 const task=(await db.query("select public.save_task(null,null,$1,'[]') v",[{scope:'PERSONAL',title:'Tâche privée Mehmet',description:'Contenu privé jamais offline',status:'TODO',priority:'NORMAL',deadline_date:'2026-10-10',deadline_at:null,timezone:'Europe/Brussels',event_id:null,event_occurrence_date:null}])).rows[0].v;
 const event=(await db.query("select public.save_agenda_event(null,null,$1,'{}') v",[{title:'Gekoppelde activiteit',description:'',location:'Locaux',category:'ACTIVITY',all_day:false,start_date:null,end_date:null,starts_at:'2026-10-04T12:00:00Z',ends_at:'2026-10-04T16:00:00Z',timezone:'Europe/Brussels',audience_type:'ALL',frequency:'NONE',recurrence_interval:1,weekdays:[],until_date:null,occurrence_count:null}])).rows[0].v;
 await db.exec('reset role;reset request.jwt.claim.sub');
 for(const [n,kind,source] of [[1,'TASK',task],[2,'EVENT',event]])await db.query("insert into public.notifications(id,user_id,kind,title,body,source_type,source_id,source_occurrence_key) values($1,$2,$3,'Herinnering privé','Texte privé',$4,$5,$6)",[id(700+n),id(1),`${kind}_REMINDER`,kind,source,kind==='EVENT'?'2026-10-04':'']);
 const tables=['profiles','site_settings','page_content','groups','contact_sections','songs','posts','contact_messages','finance_transactions','members','app_roles','app_user_roles','tasks','task_members','task_activity','task_reminders','events','event_categories','event_reminders','event_participants','event_occurrence_overrides','notifications','notification_preferences','notification_category_preferences','push_subscriptions','app_finance_activity'];
 const signatures={get_my_app_access:[],get_app_finance_snapshot:[],list_app_accounts:[],touch_push_subscription:['endpoint_value'],disable_push_subscription:['target_id'],register_push_subscription:['details'],save_notification_preferences:['details','categories'],enqueue_my_notification_test:['subscription_id'],mark_notifications_read:['target_id'],save_task_with_reminders:['target_id','expected_revision','details','assignments','reminders']};
 server=await createServer({configFile:false,root:`${root}/tests/fixtures/pwa`,resolve:{alias:{'@':`${root}/src`,'@supabase/supabase-js':`${root}/tests/fixtures/pwa/supabase.ts`}},define:{'import.meta.env.PUBLIC_SUPABASE_URL':JSON.stringify('http://127.0.0.1:54321'),'import.meta.env.PUBLIC_SUPABASE_ANON_KEY':JSON.stringify('fixture-key'),'import.meta.env.PUBLIC_VAPID_PUBLIC_KEY':JSON.stringify('A'.repeat(87)),'import.meta.env.PUBLIC_APP_BUILD':JSON.stringify('fixture-ui')},esbuild:{jsx:'automatic',jsxImportSource:'preact'},server:{host:'127.0.0.1',port:0,fs:{allow:[root]}},plugins:[{name:'pwa-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname===scope+'push-sw.js'){res.setHeader('Content-Type','application/javascript');res.setHeader('Service-Worker-Allowed',scope);res.setHeader('Cache-Control','no-store');res.end(`const APP_BUILD = ${JSON.stringify(release)};\n`+readFileSync(`${root}/src/features/app/notifications/service-worker.js`,'utf8'));return;}
  if(url.pathname===scope+'offline.html'){res.setHeader('Content-Type','text/html');res.setHeader('X-Chiro-Offline','1');res.end(offlineHtml);return;}
  if(url.pathname===scope+'manifest.webmanifest'){res.setHeader('Content-Type','application/manifest+json');res.end(JSON.stringify(appManifest(scope)));return;}
  if(url.pathname.startsWith('/assets/app/')){const name=url.pathname.split('/').pop();if(!/^((icon-(192|512|maskable-512))|apple-touch-icon)\.png$/.test(name)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type','image/png');res.end(readFileSync(`${root}/public/assets/app/${name}`));return;}
  if(url.pathname==='/public-page'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Public</title><p>Site public normal</p>');return;}
  if(url.pathname!=='/fixture-api')return next();
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  try{
   let raw='';for await(const chunk of req)raw+=chunk;const q=JSON.parse(raw);assert.ok([1,2].includes(q.actor));
   const result=await db.transaction(async tx=>{
    await tx.exec(`set local role authenticated;set local request.jwt.claim.sub='${id(q.actor)}'`);
    if(q.name){assert.ok(Object.hasOwn(signatures,q.name));const keys=signatures[q.name];const sql=`select public.${q.name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) v`;let data=(await tx.query(sql,keys.map(k=>q.args[k]))).rows[0]?.v;if(q.name==='list_app_accounts')data=(await tx.query('select * from public.list_app_accounts()')).rows;return{data,error:null};}
    assert.ok(tables.includes(q.table));const values=[];
    const clauses=q.filters.map(([column,v])=>{assert.match(column,/^[a-z_]+$/);if(v===null)return `${column} is null`;values.push(v);return `${column}=$${values.length}`;});
    const where=clauses.length?'where '+clauses.join(' and '):'';
    if(q.head)return{count:(await tx.query(`select count(*)::int n from public.${q.table} ${where}`,values)).rows[0].n,data:null,error:null};
    const order=q.orders.map(([column,asc])=>{assert.match(column,/^[a-z_]+$/);return column+(asc?' asc':' desc');});
    const rows=(await tx.query(`select to_jsonb(t) data from (select * from public.${q.table} ${where} ${order.length?'order by '+order.join(','):''} limit ${Math.min(q.limit??500,500)} offset ${Math.max(q.from??0,0)}) t`,values)).rows.map(row=>row.data);
    return{data:q.single?(rows[0]??null):rows,error:null};
   });res.end(JSON.stringify(result));
  }catch(error){res.end(JSON.stringify({data:null,error:{code:error.code,message:error.message}}));}
 });}}]});await server.listen();const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 const executablePath=process.env.PWA_BROWSER_PATH??['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(existsSync);assert.ok(executablePath);
 browser=await chromium.launch({executablePath,headless:true});const context=await browser.newContext({viewport:{width:1280,height:960}}),page=await context.newPage(),errors=[];debugPage=page;page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.pwaFixture={prompts:0,permissionCalls:0,subscription:null,outcome:'dismissed'};
  Object.defineProperty(Notification,'permission',{get:()=>window.pwaFixture.permission??'default',configurable:true});
  Notification.requestPermission=async()=>{window.pwaFixture.permissionCalls++;return window.pwaFixture.permission='granted';};
  Object.defineProperty(ServiceWorkerRegistration.prototype,'pushManager',{get(){return{getSubscription:async()=>window.pwaFixture.subscription,subscribe:async()=>{const sub={endpoint:'https://fcm.googleapis.com/fcm/send/fixture-'+crypto.randomUUID(),toJSON:()=>({endpoint:sub.endpoint,keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}}),unsubscribe:async()=>{window.pwaFixture.subscription=null;return true;}};window.pwaFixture.subscription=sub;return sub;}};}});
 });
 const login=async(email='mehmet@example.test')=>{await page.getByLabel('E-mail',{exact:true}).fill(email);await page.getByLabel('Wachtwoord',{exact:true}).fill('test-fixture-only');await page.getByRole('button',{name:'Inloggen',exact:true}).click();};
 const screen=async(name)=>{try { await page.waitForFunction(name=>document.querySelector('.admin-breadcrumb strong')?.textContent===name,name); } catch(error) { console.log('PWA fixture screen:',page.url(),await page.locator('body').innerText(),errors);throw error; }};
 await page.goto(base+scope+'?app=home');await login();await screen('Start');assert.ok(page.url().endsWith('?app=home'));await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);assert.equal(await page.evaluate(()=>window.pwaFixture.permissionCalls),0);
 const desktopMenu=page.locator('aside.admin-sidebar');
 await desktopMenu.getByRole('button',{name:'SITE',exact:true}).click();await screen('Overzicht');assert.equal(new URL(page.url()).search,'');
 await desktopMenu.getByRole('button',{name:'APP',exact:true}).click();await screen('Start');assert.ok(page.url().endsWith('?app=home'));
 assert.equal(await desktopMenu.getByRole('button',{name:'APP',exact:true}).getAttribute('aria-pressed'),'true');
 for(const [key,label]of[['agenda','Agenda'],['tasks','Taken'],['finance','Rekeningen'],['members','Leden'],['settings','Instellingen'],['notifications','Meldingen'],['home','Start']]){await page.goto(base+scope+'?app='+key);await screen(label);await page.reload();await screen(label);}
 console.log('PWA: real AdminApp launch/login and screen refresh passed');
 await page.goto(`${base}${scope}?app=tasks&task=${task}`);await page.getByRole('heading',{name:'Tâche privée Mehmet',exact:true}).waitFor();await page.reload();await page.getByRole('heading',{name:'Tâche privée Mehmet',exact:true}).waitFor();
 await page.goto(`${base}${scope}?notification=${id(702)}`);await page.getByRole('heading',{name:'Gekoppelde activiteit',exact:true}).waitFor();assert.ok(page.url().includes(`event=${event}`));await page.reload();await page.getByRole('heading',{name:'Gekoppelde activiteit',exact:true}).waitFor();
 await page.goto(`${base}${scope}?notification=${id(701)}`);await page.getByRole('heading',{name:'Tâche privée Mehmet',exact:true}).waitFor();assert.ok(page.url().includes(`task=${task}`));
 await page.goto(base+scope+'?app=settings');await screen('Instellingen');
 const firePrompt=()=>page.evaluate(()=>{const event=new Event('beforeinstallprompt');Object.assign(event,{prompt:async()=>{window.pwaFixture.prompts++;if(window.pwaFixture.outcome==='invalid')throw new Error('fixture invalid');},userChoice:Promise.resolve({outcome:window.pwaFixture.outcome})});window.dispatchEvent(event);});
 await firePrompt();assert.equal(await page.evaluate(()=>window.pwaFixture.prompts),0);await page.getByRole('button',{name:'App installeren',exact:true}).click();await page.getByText(/Installatie uitgesteld/).waitFor();assert.equal(await page.evaluate(()=>window.pwaFixture.prompts),1);
 await page.evaluate(()=>window.pwaFixture.outcome='invalid');await firePrompt();await page.getByRole('button',{name:'App installeren',exact:true}).click();await page.getByText(/Installatie is momenteel niet beschikbaar/).waitFor();
 await page.evaluate(()=>window.pwaFixture.outcome='accepted');await firePrompt();await page.getByRole('button',{name:'App installeren',exact:true}).click();await page.getByText(/Aanvraag geaccepteerd/).waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));await page.getByText(/Geïnstalleerd \/ geopend/).waitFor();
 const cachesBefore=await page.evaluate(async()=>Promise.all((await caches.keys()).map(async key=>({key,urls:(await(await caches.open(key)).keys()).map(r=>r.url)}))));assert.ok(cachesBefore.every(cache=>cache.urls.length===1&&cache.urls[0].endsWith('/offline.html')));
 await context.setOffline(true);await page.getByText('Verbinding verbroken',{exact:true}).waitFor();await page.getByRole('button',{name:'Voorkeuren opslaan'}).click();await page.getByText(/Opslaan kan niet zonder internetverbinding/).waitFor();
 await page.reload();await page.getByRole('heading',{name:'Geen internetverbinding'}).waitFor();assert.ok(!(await page.content()).includes('Tâche privée Mehmet'));
 const cold=await context.newPage();await cold.goto(base+scope+'?app=finance');await cold.getByRole('heading',{name:'Geen internetverbinding'}).waitFor();await cold.close();
 await context.setOffline(false);await page.getByRole('button',{name:'Opnieuw proberen',exact:true}).click();await screen('Instellingen');
 console.log('PWA: offline banner, blocked form, cold offline fallback and cache allowlist passed');
 release='fixture-v2';await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});await page.getByText('Nieuwe versie beschikbaar',{exact:true}).waitFor();
  let reloads=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())reloads++;});page.once('dialog',dialog=>dialog.accept());await Promise.all([page.waitForEvent('framenavigated',frame=>frame===page.mainFrame()),page.getByRole('button',{name:'Bijwerken',exact:true}).click()]);await screen('Instellingen');assert.equal(reloads,1);updates=reloads;
 await page.getByLabel('Naam van dit apparaat',{exact:true}).fill('Appareil partagé');await page.getByRole('button',{name:'Meldingen inschakelen',exact:true}).click();await page.getByText('Apparaat geregistreerd. Pushmeldingen zijn ingeschakeld.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Uitloggen',exact:true}).first().click();await page.getByRole('heading',{name:'Leiding login'}).waitFor();assert.equal((await db.query('select active from public.push_subscriptions where user_id=$1',[id(1)])).rows[0].active,false);
 const lock=await page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('chiro-push-receipts',2);request.onsuccess=()=>{const db=request.result,tx=db.transaction('device'),read=tx.objectStore('device').get('push');read.onsuccess=()=>resolve(read.result);tx.oncomplete=()=>db.close();};}));assert.deepEqual(lock,{id:'push',locked:true});
 await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'Geen internetverbinding'}).waitFor();assert.ok(!(await page.content()).includes('Tâche privée Mehmet'));await context.setOffline(false);await page.getByRole('button',{name:'Opnieuw proberen',exact:true}).click();await page.getByRole('heading',{name:'Leiding login'}).waitFor();
 await page.goto(`${base}${scope}?app=tasks&task=${task}`);await login('thomas@example.test');await page.getByRole('alert').filter({hasText:'Deze taak is niet meer toegankelijk met jouw account.'}).waitFor();assert.equal(await page.getByRole('heading',{name:'Tâche privée Mehmet',exact:true}).count(),0);
 assert.equal(await desktopMenu.getByRole('button',{name:'SITE',exact:true}).count(),0,'APP-only accounts do not receive SITE access');
 await page.goto(base+scope+'?app=settings');await screen('Instellingen');await page.getByRole('button',{name:'Meldingen inschakelen',exact:true}).click();await page.getByText('Apparaat geregistreerd. Pushmeldingen zijn ingeschakeld.',{exact:true}).waitFor();
 assert.equal((await db.query('select count(*)::int n from public.push_subscriptions where active')).rows[0].n,1);
 await page.setViewportSize({width:390,height:844});await page.getByRole('navigation',{name:'APP-navigatie',exact:true}).waitFor();await page.getByRole('navigation',{name:'APP-navigatie',exact:true}).getByRole('button',{name:'Agenda',exact:true}).click();await screen('Agenda');assert.ok(page.url().includes('app=agenda'));
 await page.getByRole('button',{name:'Meer onderdelen',exact:true}).click();await page.getByRole('dialog',{name:'Navigatie',exact:true}).getByRole('button',{name:'Instellingen',exact:true}).click();await screen('Instellingen');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 mkdirSync(`${root}/.test-artifacts`,{recursive:true});await page.screenshot({path:`${root}/.test-artifacts/pwa-mobile.png`,fullPage:true});
 const publicPage=await context.newPage();await publicPage.goto(base+'/public-page');assert.equal(await publicPage.evaluate(()=>!!navigator.serviceWorker.controller),false);assert.equal(await publicPage.locator('link[rel=manifest]').count(),0);await publicPage.close();
 await context.setOffline(true);await page.getByText('Verbinding verbroken',{exact:true}).waitFor();await page.getByRole('button',{name:'Meer onderdelen',exact:true}).click();await page.getByRole('dialog',{name:'Navigatie',exact:true}).getByRole('button',{name:'Uitloggen',exact:true}).click();await page.getByRole('heading',{name:'Leiding login'}).waitFor();await page.getByText(/Het uitschakelen van pushmeldingen kon niet overal worden bevestigd/).waitFor();
 assert.equal((await db.query('select count(*)::int n from public.push_subscriptions where user_id=$1 and active',[id(2)])).rows[0].n,1,'offline logout reports unconfirmed server cleanup');
 await context.setOffline(false);await Promise.all([page.waitForResponse(response=>response.url().endsWith('/fixture-api')&&JSON.parse(response.request().postData()??'{}').name==='disable_push_subscription'),login('thomas@example.test')]);await screen('Start');assert.equal((await db.query('select count(*)::int n from public.push_subscriptions where active')).rows[0].n,0);
 await page.goto(base+scope+'?app=settings');await screen('Instellingen');await page.evaluate(()=>{Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (iPhone)',configurable:true});Object.defineProperty(navigator,'standalone',{value:false,configurable:true});window.dispatchEvent(new Event('focus'));});await page.getByRole('region',{name:'Instructies voor iPhone en iPad'}).waitFor();
 await page.evaluate(()=>{Object.defineProperty(navigator,'standalone',{value:true,configurable:true});window.dispatchEvent(new Event('focus'));});await page.getByText(/Geïnstalleerd \/ geopend/).waitFor();assert.equal(await page.getByRole('region',{name:'Instructies voor iPhone en iPad'}).count(),0);
 assert.deepEqual(errors,[]);console.log(`PWA browser passed: real AdminApp with simulated Auth, real SQL/RLS, all deep links/refresh, private task denial, install capability mock, actual SW/cache/offline/update (${updates} reload), logout/account change, mobile navigation. No physical installation or real Push tested.`);
}catch(error){if(debugPage)console.log('PWA fixture failure:',debugPage.url(),await debugPage.locator('body').innerText());throw error;}finally{await browser?.close();await server?.close();await db.close();}
