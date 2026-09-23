import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { database, fixtureId as id } from '../tests/helpers/database.ts';
const root=fileURLToPath(new URL('..',import.meta.url)),db=await database(true,true,true);
let server,browser;
try{
 await db.exec(`insert into auth.users(id,email) values('${id(1)}','push@example.test'); insert into public.app_user_roles(user_id,role_key) values('${id(1)}','MEMBER');`);
 for(let n=1;n<=31;n++)await db.query("insert into public.notifications(id,user_id,kind,title,body,source_type,source_id) values($1,$2,'TASK_REMINDER',$3,'Une échéance approche','TASK',$4)",[id(1000+n),id(1),`Rappel ${n}`,id(900)]);
 const tables=['notifications','notification_preferences','notification_category_preferences','event_categories','push_subscriptions'];
 server=await createServer({configFile:false,root:`${root}/tests/fixtures/notifications`,esbuild:{jsx:'automatic',jsxImportSource:'preact'},server:{host:'127.0.0.1',port:0,fs:{allow:[root]}},plugins:[{name:'notification-db',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  if(!req.url?.startsWith('/fixture-api'))return next();res.setHeader('Content-Type','application/json');
  try{
   let raw='';for await(const chunk of req)raw+=chunk;const q=JSON.parse(raw);
   const result=await db.transaction(async tx=>{
    await tx.exec(`set local role authenticated;set local request.jwt.claim.sub='${id(1)}'`);
    if(q.name){
     const signatures={save_notification_preferences:['details','categories'],mark_notifications_read:['target_id'],register_push_subscription:['details'],disable_push_subscription:['target_id'],touch_push_subscription:['endpoint_value'],enqueue_my_notification_test:['subscription_id']};assert.ok(Object.hasOwn(signatures,q.name));
     const keys=signatures[q.name];return {data:(await tx.query(`select public.${q.name}(${keys.map((_,i)=>`$${i+1}`).join(',')}) v`,keys.map(k=>q.args[k]))).rows[0].v,error:null};
    }
    assert.ok(tables.includes(q.table));assert.ok(!q.column||['id','read_at'].includes(q.column));
    const args=[],where=q.column?(q.value===null?`where ${q.column} is null`:(args.push(q.value),`where ${q.column}=$1`)):'';
    if(q.head)return{data:null,count:(await tx.query(`select count(*)::int n from public.${q.table} ${where}`,args)).rows[0].n,error:null};
    const columns=q.table==='push_subscriptions'?'id,device_label,active,last_seen_at':'*';
    const order=q.table==='notifications'?'created_at desc,id':q.table==='event_categories'?'key':q.table==='notification_category_preferences'?'category_key':'user_id';
    const rows=(await tx.query(`select ${columns} from public.${q.table} ${where} order by ${q.table==='push_subscriptions'?'id':order} limit ${Math.min(q.limit??100,100)} offset ${Math.max(q.from??0,0)}`,args)).rows;
    return{data:q.single?(rows[0]??null):rows,error:null};
   });res.end(JSON.stringify(result));
  }catch(error){res.end(JSON.stringify({data:null,error:{code:error.code,message:'Fixture request failed'}}));}
 });}}]});await server.listen();
 const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 const executablePath=process.env.NOTIFICATIONS_BROWSER_PATH??['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(existsSync);assert.ok(executablePath);
 browser=await chromium.launch({executablePath,headless:true});const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.pushFixture={requests:0,subscription:null};
  class Notifications {static permission='default';static async requestPermission(){window.pushFixture.requests++;return Notifications.permission='granted';}}
  Object.defineProperty(window,'Notification',{value:Notifications,configurable:true});Object.defineProperty(window,'PushManager',{value:class{},configurable:true});
  const reg={active:{postMessage:(_data,ports)=>ports[0].postMessage({ok:true})},getNotifications:async()=>[],pushManager:{getSubscription:async()=>window.pushFixture.subscription,subscribe:async()=>{
   const sub={endpoint:'https://fcm.googleapis.com/fcm/send/browser',toJSON:()=>({endpoint:sub.endpoint,keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}}),unsubscribe:async()=>{window.pushFixture.subscription=null;return true;}};window.pushFixture.subscription=sub;return sub;
  }}};Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>reg,getRegistration:async()=>reg,ready:Promise.resolve(reg)},configurable:true});
 });
 await page.goto(base);await page.getByRole('heading',{name:'Notifications et rappels'}).waitFor();
 await page.getByRole('button',{name:'Activer les notifications',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.pushFixture.requests),0);
 await page.getByRole('button',{name:'Notifications : 31 non lues',exact:true}).click();await page.getByText('Page 1',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.notification-item').length===30);
 await page.getByRole('button',{name:'Suivantes',exact:true}).click();await page.getByText('Page 2',{exact:true}).waitFor();assert.equal(await page.locator('.notification-item').count(),1);
 await page.getByRole('button',{name:'Tout marquer comme lu'}).click();await page.getByRole('button',{name:'Notifications : 0 non lues',exact:true}).waitFor();
 await page.locator('.notification-item').click();await page.getByTestId('target').filter({hasText:`TASK:${id(900)}`}).waitFor();
 await page.getByLabel('Rappels Tâches',{exact:true}).uncheck();await page.getByRole('button',{name:'Enregistrer les préférences'}).click();await page.getByText('Préférences enregistrées.',{exact:true}).waitFor();
 assert.equal((await db.query('select task_notifications_enabled v from public.notification_preferences')).rows[0].v,false);
 await page.getByRole('button',{name:'Activer les notifications',exact:true}).click();await page.getByText('Appareil inscrit. Les notifications Push sont activées.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.pushFixture.requests),1);
 await page.getByRole('button',{name:'Envoyer une notification de test'}).click();await page.getByText(/Test mis en file/).waitFor();assert.equal((await db.query("select count(*)::int n from public.notification_jobs where source_type='SYSTEM'")).rows[0].n,1);
 await page.getByRole('button',{name:'Désactiver sur cet appareil',exact:true}).click();await page.getByText('Notifications désactivées sur cet appareil.',{exact:true}).waitFor();assert.equal((await db.query('select active v from public.push_subscriptions')).rows[0].v,false);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Notifications : 0 non lues',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.notification-item').length===30);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));mkdirSync(`${root}/.test-artifacts`,{recursive:true});await page.screenshot({path:`${root}/.test-artifacts/notifications-mobile.png`});await page.getByRole('button',{name:'Fermer',exact:true}).click();
 await page.goto(`${base}/?notification=${id(1001)}`);await page.getByTestId('target').filter({hasText:`TASK:${id(900)}`}).waitFor();assert.ok(!page.url().includes('notification='));
 await page.evaluate(()=>{Notification.permission='denied';window.dispatchEvent(new Event('focus'));});await page.getByRole('button',{name:'Enregistrer les préférences'}).click();await page.getByText(/État : Refusé/).waitFor();assert.ok(await page.getByRole('button',{name:'Activer les notifications',exact:true}).isDisabled());assert.equal(await page.evaluate(()=>window.pushFixture.requests),0);
 assert.deepEqual(errors,[]);console.log('Notifications browser passed: real SQL/RLS, 30-row pagination, read/all-read, target, preferences, explicit permission, mocked subscription/test/unsubscribe, denied state, desktop/mobile. No real Web Push sent.');
}finally{await browser?.close();await server?.close();await db.close();}
