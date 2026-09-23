import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { validPushEndpoint } from "../src/server/notifications/web-push.ts";
const sw = readFileSync(new URL("../src/features/app/notifications/service-worker.js",import.meta.url),"utf8");
test("Push worker: robust malformed payload, active delivery dedup, scoped click, no private cache",async()=>{
 const handlers:Record<string,(event:any)=>void>={},shown:any[]=[],opened:string[]=[],focused:string[]=[];
 let existing:any[]=[];
 const self={addEventListener:(name:string,fn:any)=>handlers[name]=fn,registration:{scope:"https://example.test/secret-admin/",getNotifications:async({tag}:any)=>shown.filter(n=>n.options.tag===tag),showNotification:async(title:string,options:any)=>{shown.push({title,options});}},clients:{matchAll:async()=>existing,openWindow:async(url:string)=>{opened.push(url);}},skipWaiting:async()=>{}};
 vm.runInNewContext(sw,{self,URL,Date,Promise});
 assert.equal(handlers.fetch,undefined);
 const emit=async(name:string,event:any)=>{let pending:Promise<unknown>=Promise.resolve();handlers[name]({...event,waitUntil:(p:Promise<unknown>)=>pending=p});await pending;};
 await emit("push",{});await emit("push",{data:{text:()=>"{invalid"}});assert.equal(shown.length,2);assert.equal(shown[0].title,"Chiro Negenmanneke");
 const notificationId="00000000-0000-4000-8000-000000000001",deliveryId="00000000-0000-4000-8000-000000000002";
 const data={text:()=>JSON.stringify({notificationId,deliveryId,title:"A".repeat(200),body:"B".repeat(500),targetPath:"https://evil.test/"})};
 await emit("push",{data});await emit("push",{data});assert.equal(shown.length,3);assert.equal(shown[2].title.length,120);assert.equal(shown[2].options.body.length,240);
 await emit("notificationclick",{notification:{close(){},data:{notificationId,targetPath:"https://evil.test/"}}});assert.deepEqual(opened,[`https://example.test/secret-admin/?notification=${notificationId}`]);
 existing=[{url:"https://example.test/secret-admin/",navigate:async(url:string)=>{focused.push(url);return{focus:async()=>focused.push("focused")};}}];
 await emit("notificationclick",{notification:{close(){},data:{notificationId:"invalid"}}});assert.deepEqual(focused,["https://example.test/secret-admin/","focused"]);assert.equal(opened.length,1);
});
test("Push provider allowlist blocks SSRF, credentials and alternate ports",()=>{
 for(const endpoint of ["https://fcm.googleapis.com/fcm/send/test","https://updates.push.services.mozilla.com/wpush/v2/test","https://web.push.apple.com/test","https://wns2-test.notify.windows.com/test"])assert.equal(validPushEndpoint(endpoint),true);
 for(const endpoint of ["http://fcm.googleapis.com/test","https://fcm.googleapis.com.evil.test/test","https://127.0.0.1/","https://localhost/","https://user:pass@fcm.googleapis.com/test","https://fcm.googleapis.com:8443/test","https://fcm.googleapis.com/test#fragment"])assert.equal(validPushEndpoint(endpoint),false);
});
