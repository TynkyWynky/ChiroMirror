import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, readdir } from 'node:fs/promises';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, sep, dirname, basename, extname } from 'node:path';
import { chromium } from 'playwright-core';

// Read-only local fixtures; no production network or database mutations.
const content = JSON.parse(readFileSync(new URL('../src/data/default-content.json', import.meta.url), 'utf8'));
const artifactDir = process.env.PUBLIC_QA_ARTIFACT_DIR ?? '.test-artifacts/phase8';
mkdirSync(artifactDir, { recursive: true });
let mode = 'empty', reads = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  assert.equal(init?.method ?? 'GET', 'GET', 'External mutation forbidden');
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname.includes('/rest/v1/')) { reads++; }
  if (mode === 'fallback') return Response.json({ message: 'Simulated unavailable CMS' }, { status: 503 });
  if (url.pathname.includes('/storage/v1/object/public/site-media/')) return new Response('%PDF-1.4 local fixture', { headers: { 'Content-Type': 'application/pdf' } });
  if (mode === 'populated') {
    if (url.pathname.endsWith('/groups')) return Response.json([{...content.groups[0],slug:'cms-testgroep',name:'CMS groep'}]);
    if (url.pathname.endsWith('/page_content')) return Response.json([
      {slug:'registration',data:{...content.pages.registration,title:'CMS inschrijven controle'}},
      {slug:'camp',data:{...content.pages.camp,title:'CMS kamp controle'}},
      {slug:'privacy',data:{...content.pages.privacy,title:'CMS privacy controle'}},
      {slug:'home',data:{...content.pages.home,practical:{...content.pages.home.practical,items:['Wanneer: CMS zondaginfo']},history:{...content.pages.home.history,body:'CMS geschiedenis controle'}}}
    ]);
  }
  return Response.json([]);
};
const root = resolve('dist');
const types = { '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
let server, browser;
try {
  const { default: handler } = await import('../.netlify/v1/functions/ssr/ssr.mjs');
  server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'GET');
      const url = new URL(req.url, `http://${req.headers.host}`);
      const file = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (file.startsWith(root + sep) && await stat(file).then(s => s.isFile()).catch(() => false)) {
        assert.ok((await readdir(dirname(file))).includes(basename(file)), `Asset casing: ${file}`);
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
        res.end(await readFile(file)); return;
      }
      const response = await handler(new Request(url), { ip: '127.0.0.1' });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { console.error(error); res.writeHead(500); res.end('Local test error'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.PWA_BROWSER_PATH ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(existsSync);
  assert.ok(executablePath, 'Set PWA_BROWSER_PATH to a Chromium browser');
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext();
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));




  page.setDefaultTimeout(12000);
  const fresh=async(options={},init)=>{
    const c=await browser.newContext({viewport:{width:1440,height:900},...options});
    await c.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
    if(init)await c.addInitScript(init);
    const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(12000);await p.goto(base+'/');return p;
  };
  const signup=p=>p.locator('.home-hero a[data-signup-motion]').first();
  // Full sequence: source geometry, exact center, branded frame, real destination.
  let p=await fresh();const href=await signup(p).getAttribute('href');const before=await signup(p).boundingBox();let start=Date.now();
  await signup(p).click();await p.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:false})));assert.equal(await p.locator('#signup-motion').evaluate(e=>e.open),true);
  assert.equal(await p.locator('.signup-motion-skip').evaluate(e=>e===document.activeElement),true);
  await p.waitForFunction(()=>{const a=document.querySelector('.signup-motion-flight')?.getAnimations()[0];return a&&Number(a.currentTime)>=700;});
  const center=await p.locator('.signup-motion-flight').boundingBox();assert.ok(Math.abs(center.x+center.width/2-720)<2);assert.ok(Math.abs(center.y+center.height/2-450)<2);
  assert.deepEqual(await signup(p).boundingBox(),before,'Original CTA did not move');assert.equal(await signup(p).getAttribute('href'),href);
  await p.keyboard.press('Tab');assert.ok(await p.locator('#signup-motion').evaluate(e=>e.contains(document.activeElement)));
  await p.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.signup-motion-brand')).opacity)>.9);
  await p.screenshot({path:artifactDir+'/signup-desktop.png'});
  await p.waitForURL('**/inschrijven.html');const elapsed=Date.now()-start;assert.ok(elapsed>=2800&&elapsed<6000,'Full duration '+elapsed);
  await p.goto(base+'/');start=Date.now();await signup(p).click();await p.waitForURL('**/inschrijven.html');assert.ok(Date.now()-start<1800,'Repeat should be short');
  await p.goBack();assert.equal(await p.locator('#signup-motion').evaluate(e=>e.open),false);assert.equal(await p.locator('body').evaluate(e=>e.classList.contains('signup-motion-open')),false);
  console.log('PASS full desktop sequence (~3s), centered clone/no layout shift, logo/focus, original destination, short session repeat and history cleanup');
  // Full mobile sequence, then skip from the native menu in a new session.
  p=await fresh({viewport:{width:375,height:812}});await signup(p).click();
  await p.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.signup-motion-brand')).opacity)>.9);
  await p.screenshot({path:artifactDir+'/signup-mobile.png'});await p.locator('.signup-motion-skip').click();await p.waitForURL('**/inschrijven.html');
  p=await fresh({viewport:{width:375,height:812}});await p.getByRole('button',{name:'Menu openen',exact:true}).click();await p.locator('#mobile-nav [data-signup-motion]').click();
  assert.equal(await p.locator('#signup-motion').evaluate(e=>e.open),true);assert.ok(await p.locator('.signup-motion-flight').boundingBox());await p.keyboard.press('Escape');await p.waitForURL('**/inschrijven.html');
  p=await fresh();await signup(p).focus();await p.keyboard.press('Enter');assert.equal(await p.locator('#signup-motion').evaluate(e=>e.open),true);await p.keyboard.press('Escape');await p.waitForURL('**/inschrijven.html');
  console.log('PASS mobile branding/skip, mobile-menu source rectangle, keyboard Enter and Escape');
  p=await fresh();await p.locator('.footer-signup').scrollIntoViewIfNeeded();const scrollBefore=await p.evaluate(()=>scrollY);await p.locator('.footer-signup').click();assert.equal(await p.evaluate(()=>scrollY),scrollBefore);await p.locator('.signup-motion-skip').click();await p.waitForURL('**/inschrijven.html');
  p=await fresh({viewport:{width:812,height:375}});await signup(p).click();
  await p.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.signup-motion-brand')).opacity)>.9);
  const titleBounds=await p.locator('#signup-motion-title').boundingBox(),skipBounds=await p.locator('.signup-motion-skip').boundingBox();
  assert.ok(titleBounds.y>=0&&titleBounds.y+titleBounds.height<skipBounds.y,'Landscape branding and skip remain separate');
  assert.equal(Math.round((await p.locator('#signup-motion').boundingBox()).width),812,'Fullscreen covers the scrollbar gutter');
  await p.screenshot({path:artifactDir+'/signup-landscape.png'});await p.locator('.signup-motion-skip').click();await p.waitForURL('**/inschrijven.html');
  // Modified clicks and special anchors must retain native behavior. A final
  // recorder prevents test-only default navigation AFTER our capture listener.
  p=await fresh();
  const results=await p.evaluate(()=>{
    const source=document.querySelector('.home-hero a[data-signup-motion]');const values=[];
    const probe=(changes={},options={})=>{
      const a=source.cloneNode(true);Object.entries(changes).forEach(([k,v])=>v===null?a.removeAttribute(k):a.setAttribute(k,v));document.querySelector('main').append(a);
      document.addEventListener('click',e=>{values.push(e.defaultPrevented);e.preventDefault();},{once:true});
      a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0,...options}));a.remove();
    };
    for(const key of ['ctrlKey','metaKey','shiftKey','altKey'])probe({}, {[key]:true});
    probe({}, {button:1});probe({target:'_blank'});probe({target:'_parent'});probe({download:''});probe({rel:'external'});probe({href:'https://external.invalid/inschrijven.html'});probe({'data-signup-motion':null});
    return values;
  });assert.deepEqual(results,Array(11).fill(false));assert.equal(await p.locator('#signup-motion').evaluate(e=>e.open),false);
  // Duplicate ordinary activations share exactly one modal/flight/timer.
  await signup(p).click();await p.evaluate(()=>document.querySelector('.home-hero a[data-signup-motion]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0})));
  assert.equal(await p.locator('.signup-motion-flight').count(),1);await p.locator('.signup-motion-skip').click();await p.waitForURL('**/inschrijven.html');
  console.log('PASS modifier/middle clicks, targets, downloads, external/unmarked links and duplicate activation guard');
  for(const [label,options,init]of [
    ['reduced motion',{reducedMotion:'reduce'},null],
    ['no JavaScript',{javaScriptEnabled:false},null],
    ['missing WAAPI',{},()=>{Element.prototype.animate=undefined;}],
    ['missing modal API',{},()=>{HTMLDialogElement.prototype.showModal=undefined;}],
    ['animation throws',{},()=>{Element.prototype.animate=()=>{throw Error('Simulated animation failure');};}]
  ]){
    p=await fresh(options,init);start=Date.now();await signup(p).click();await p.waitForURL('**/inschrijven.html');assert.ok(Date.now()-start<2200,label+' should navigate immediately');
    assert.equal(await p.locator('#signup-motion').evaluate(e=>e.open),false);console.log('PASS immediate navigation: '+label);
  }
  p=await fresh({},()=>{Storage.prototype.getItem=()=>{throw Error('blocked');};Storage.prototype.setItem=()=>{throw Error('blocked');};});
  await signup(p).click();assert.equal(await p.locator('#signup-motion').evaluate(e=>e.open),true);await p.locator('.signup-motion-skip').click();await p.waitForURL('**/inschrijven.html');
  p=await fresh();await signup(p).click();await p.emulateMedia({reducedMotion:'reduce'});await p.waitForURL('**/inschrijven.html');
  console.log('PASS blocked storage fallback and live reduced-motion change');
  // Record native card reveals without replacing the native implementation.
  p=await fresh({},()=>{
    window.__cardReveals=[];const animate=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){if(this.matches('.home-department'))window.__cardReveals.push({slug:this.dataset.department,delay:options.delay,duration:options.duration});return animate.call(this,frames,options);};
  });
  for(const card of await p.locator('.home-department').all())await card.scrollIntoViewIfNeeded();
  await p.waitForFunction(()=>window.__cardReveals.length===6);const calls=await p.evaluate(()=>window.__cardReveals);
  assert.equal(new Set(calls.map(c=>c.slug)).size,6);assert.ok(calls.every(c=>c.duration===550));assert.deepEqual(calls.map(c=>c.delay).sort((a,b)=>a-b),[0,55,110,165,220,275]);
  await p.evaluate(()=>scrollTo(0,0));for(const card of await p.locator('.home-department').all())await card.scrollIntoViewIfNeeded();assert.equal(await p.evaluate(()=>window.__cardReveals.length),6);
  await p.emulateMedia({reducedMotion:'reduce'});await p.locator('.home-department').first().hover();assert.equal(await p.locator('.home-department').first().evaluate(e=>getComputedStyle(e).transform),'none');
  assert.equal(await p.locator('.home-department-orbit').count(),1);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);console.log('PASS once-only stagger, live cancellation, preserved orbit/reduced-motion hover; zero page errors and no production traffic');
} finally {await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());globalThis.fetch=realFetch;}
