import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { validPushEndpoint } from "../src/server/notifications/web-push.ts";
const sw = readFileSync(new URL("../src/features/app/notifications/service-worker.js",import.meta.url),"utf8");
test("Push worker: robust malformed payload, active delivery dedup, scoped click, no private cache",async()=>{
 const handlers:Record<string,(event:any)=>void>={},shown:any[]=[],opened:string[]=[],focused:string[]=[];
 let existing:any[]=[];
 const self={indexedDB:undefined as object|undefined,addEventListener:(name:string,fn:any)=>handlers[name]=fn,registration:{scope:"https://example.test/secret-admin/",getNotifications:async({tag}:any)=>shown.filter(n=>n.options.tag===tag),showNotification:async(title:string,options:any)=>{shown.push({title,options});}},clients:{matchAll:async()=>existing,openWindow:async(url:string)=>{opened.push(url);}},skipWaiting:async()=>{}};
 const context=vm.createContext({self,URL,Date,Promise});vm.runInContext(sw,context);
 assert.equal(typeof handlers.fetch,"function"); // PWA now handles only APP navigations; separate cache tests cover privacy.
 const emit=async(name:string,event:any)=>{let pending:Promise<unknown>=Promise.resolve();handlers[name]({...event,waitUntil:(p:Promise<unknown>)=>pending=p});await pending;};
 await emit("push",{});await emit("push",{data:{text:()=>"{invalid"}});assert.equal(shown.length,2);assert.equal(shown[0].title,"Chiro Negenmanneke");
 const notificationId="00000000-0000-4000-8000-000000000001",deliveryId="00000000-0000-4000-8000-000000000002";
 const data={text:()=>JSON.stringify({notificationId,deliveryId,title:"A".repeat(200),body:"B".repeat(500),targetPath:"https://evil.test/"})};
 await emit("push",{data});await emit("push",{data});assert.equal(shown.length,3);assert.equal(shown[2].title.length,120);assert.equal(shown[2].options.body.length,240);
 await emit("notificationclick",{notification:{close(){},data:{notificationId,targetPath:"https://evil.test/"}}});assert.deepEqual(opened,[`https://example.test/secret-admin/?app=notifications&notification=${notificationId}`]);
 existing=[{url:"https://example.test/secret-admin/",navigate:async(url:string)=>{focused.push(url);return{focus:async()=>focused.push("focused")};}}];
 await emit("notificationclick",{notification:{close(){},data:{notificationId:"invalid"}}});assert.deepEqual(focused,["https://example.test/secret-admin/?app=notifications","focused"]);assert.equal(opened.length,1);
 self.indexedDB={};vm.runInContext("deviceState = async () => ({locked:true})",context);
 await emit("push",{});assert.equal(shown.length,3,"logout lock suppresses incoming Push");
 vm.runInContext("deviceState = async () => ({locked:false,deviceKey:'new-device-key'})",context);
 await emit("push",{data});assert.equal(shown.length,3,"old endpoint payload cannot cross accounts");
 await emit("push",{data:{text:()=>JSON.stringify({notificationId,deliveryId:'00000000-0000-4000-8000-000000000003',deviceKey:'new-device-key',title:'Own device',body:'Allowed'})}});assert.equal(shown.length,4);
});
test("Push provider allowlist blocks SSRF, credentials and alternate ports",()=>{
 for(const endpoint of ["https://fcm.googleapis.com/fcm/send/test","https://updates.push.services.mozilla.com/wpush/v2/test","https://web.push.apple.com/test","https://wns2-test.notify.windows.com/test"])assert.equal(validPushEndpoint(endpoint),true);
 for(const endpoint of ["http://fcm.googleapis.com/test","https://fcm.googleapis.com.evil.test/test","https://127.0.0.1/","https://localhost/","https://user:pass@fcm.googleapis.com/test","https://fcm.googleapis.com:8443/test","https://fcm.googleapis.com/test#fragment"])assert.equal(validPushEndpoint(endpoint),false);
});
