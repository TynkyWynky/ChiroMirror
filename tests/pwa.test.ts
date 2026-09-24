import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import sharp from "sharp";
import { appManifest } from "../src/server/pwa.ts";
import { appRouteUrl, appScreens, readAppRoute } from "../src/features/app/pwa/routes.ts";
import { requireOnline, networkError } from "../src/features/app/pwa/network.ts";
test("PWA manifest stable identity, configurable scope, safe shortcuts and real icon dimensions",async()=>{
 const a=appManifest('/my-app/'),b=appManifest('/renamed/');assert.equal(a.id,b.id);assert.equal(a.start_url,'/my-app/?app=home');assert.equal(b.scope,'/renamed/');assert.equal(a.display,'standalone');assert.equal(a.short_name,'Negenmanneke');
 for(const icon of a.icons){const meta=await sharp(`public${icon.src}`).metadata();assert.equal(icon.sizes,`${meta.width}x${meta.height}`);assert.equal(meta.width,meta.height);}
 assert.equal((await sharp('public/assets/app/apple-touch-icon.png').metadata()).width,180);
 assert.ok(a.shortcuts.every(s=>s.url.startsWith(a.scope)));assert.ok(!JSON.stringify(a).includes('user='));
});
test("PWA URLs round-trip screens/resources, validate input and never accept external redirects",()=>{
 for(const screen of appScreens)assert.deepEqual(readAppRoute(appRouteUrl('/app/',{screen}).split('?')[1]),{screen});
 const task='00000000-0000-4000-8000-000000000001';
 assert.deepEqual(readAppRoute(`?task=${task}&next=https://evil.test/`),{screen:'tasks',task});
 assert.deepEqual(readAppRoute(`?app=agenda&event=${task}&occurrence=2026-10-04`),{screen:'agenda',event:task,occurrence:'2026-10-04'});
 assert.equal(readAppRoute(`?event=${task}&occurrence=2026-02-31`)?.occurrence,undefined);
 assert.deepEqual(readAppRoute('?app=https://evil.test/'),{screen:'home'});assert.throws(()=>appRouteUrl('//evil.test/',{screen:'home'}));assert.equal(readAppRoute('?next=https://evil.test/'),null);
});
test("PWA network guards block mutations without pretending navigator.online proves connectivity",()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{value:{onLine:false},configurable:true});
 try{assert.throws(requireOnline,/Opslaan kan niet/);assert.match(networkError(new TypeError('Failed to fetch'))!,/niet bevestigd/);}
 finally{if(old)Object.defineProperty(globalThis,'navigator',old);else Reflect.deleteProperty(globalThis,'navigator');}
 assert.match(networkError({code:'PGRST301'})!,/sessie is verlopen/);
});
test("PWA worker caches only generic fallback, bypasses APIs/public/Auth and waits for consent to update",async()=>{
 const handlers:Record<string,(e:any)=>void>={},storage=new Map<string,Map<string,Response>>();let offline=false,skip=0;
 const scope='https://example.test/private/',prefix='chiro-app-static:/private/:';
 for(const key of [prefix+'old','foreign-cache','chiro-app-static:/other/:old'])storage.set(key,new Map());
 const caches={keys:async()=>[...storage.keys()],delete:async(key:string)=>storage.delete(key),open:async(key:string)=>{if(!storage.has(key))storage.set(key,new Map());const cache=storage.get(key)!;return{put:async(url:string,res:Response)=>{cache.set(url,res.clone());},match:async(url:string)=>cache.get(url)?.clone()};}};
 const self={registration:{scope},clients:{claim:async()=>{}},addEventListener:(name:string,fn:any)=>handlers[name]=fn,skipWaiting:async()=>{skip++;}};
 const fetch=async(request:any)=>{if(offline)throw new Error('offline');const url=typeof request==='string'?request:request.url;return new Response(url.endsWith('offline.html')?'GENERIC OFFLINE':'PRIVATE FINANCE TASKS EVENTS MEMBERS NOTIFICATIONS',{headers:url.endsWith('offline.html')?{'X-Chiro-Offline':'1'}:{}});};
 vm.runInNewContext(readFileSync('src/features/app/notifications/service-worker.js','utf8'),{self,URL,Date,Promise,caches,fetch,Response,APP_BUILD:'new'});
 const emit=async(name:string,extra:any={})=>{let work:Promise<any>|undefined;handlers[name]({...extra,waitUntil:(p:Promise<any>)=>work=p,respondWith:(p:Promise<any>)=>work=p});return work?await work:undefined;};
 await emit('install');assert.equal(skip,0);await emit('activate');assert.deepEqual([...storage.keys()].sort(),['foreign-cache','chiro-app-static:/other/:old',prefix+'new'].sort());
 const request={url:scope+'?app=finance',method:'GET',mode:'navigate'};
 assert.match(await(await emit('fetch',{request})).text(),/PRIVATE/);
 offline=true;assert.equal(await(await emit('fetch',{request})).text(),'GENERIC OFFLINE');
 for(const request of [{url:scope+'api/private',method:'GET',mode:'navigate'},{url:scope+'auth-action/',method:'GET',mode:'navigate'},{url:'https://example.test/',method:'GET',mode:'navigate'},{url:'https://db.supabase.co/rest/v1/tasks',method:'GET',mode:'cors'},{url:scope,method:'POST',mode:'navigate'},{url:scope,method:'GET',mode:'cors'}])assert.equal(await emit('fetch',{request}),undefined);
 assert.deepEqual([...storage.get(prefix+'new')!.keys()],[scope+'offline.html']);
 await emit('message',{source:{url:'https://example.test/'},data:{type:'ACTIVATE_UPDATE'}});assert.equal(skip,0);
 await emit('message',{source:{url:scope+'?app=settings'},data:{type:'ACTIVATE_UPDATE'}});assert.equal(skip,1);
});
