import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, readdir } from 'node:fs/promises';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, sep, dirname, basename, extname } from 'node:path';
import { chromium } from 'playwright-core';

// Read-only local fixtures; no production network or database mutations.
const content = JSON.parse(readFileSync(new URL('../src/data/default-content.json', import.meta.url), 'utf8'));
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
      {slug:'home',data:{...content.pages.home,history:{...content.pages.home.history,body:'CMS geschiedenis controle'}}}
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
  mkdirSync('.test-artifacts/phase5', { recursive: true });



  const routes=['/','/groepen.html','/leiding.html','/activiteiten.html','/inschrijven.html','/kamp.html','/contact.html','/chiroliedjes.html','/verhuur.html','/verzekering.html','/privacy.html','/praktisch.html','/geschiedenis.html',...content.groups.map(g=>'/groepen/'+g.slug+'/')];
  const titles=new Set(),links=new Set(),metrics=[];
  await page.addInitScript(()=>{
    window.__quality={lcp:0,cls:0};
    new PerformanceObserver(list=>{for(const e of list.getEntries())window.__quality.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});
    new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.__quality.cls+=e.value;}).observe({type:'layout-shift',buffered:true});
  });
  for(const width of [320,375,430,768,1024,1440,1920]) {
    await page.setViewportSize({width,height:900});
    for(const route of routes) {
      assert.equal((await page.goto(base+route)).status(),200,route);
      assert.equal(await page.locator('main h1').count(),1,route);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+' overflow '+route);
      assert.deepEqual(await page.locator('main h1,main h2,main h3').evaluateAll(es=>es.filter(e=>e.getClientRects().length&&e.scrollWidth>e.clientWidth+1).map(e=>e.textContent.trim())),[],width+' clipped heading '+route);
      assert.equal(await page.locator('img:not([alt])').count(),0);
      assert.equal(new URL(await page.locator('link[rel="canonical"]').getAttribute('href')).pathname,route);
      assert.ok((await page.locator('meta[name="description"]').getAttribute('content')).trim());
      assert.ok((await page.locator('meta[property="og:image"]').getAttribute('content')).startsWith('https://'));
      if(width===1440) {const title=await page.title();assert.ok(!titles.has(title),title);titles.add(title);}
      for(const img of await page.locator('main img').all()) {
        await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode());
        assert.ok(await img.evaluate(e=>e.naturalWidth>0));
        assert.ok(await img.getAttribute('width'));assert.ok(await img.getAttribute('height'));
        const source=await img.getAttribute('src');
        if(['/assets/banner.jpg','/assets/kampfoto.jpg','/assets/ribbels.jpg'].includes(source)) assert.ok((await img.evaluate(e=>e.currentSrc)).endsWith('.webp'));
      }
      const headings=await page.locator('main h1,main h2,main h3,main h4').evaluateAll(es=>es.filter(e=>e.getClientRects().length).map(e=>Number(e.tagName[1])));
      assert.ok(headings.every((level,i)=>i===0||level<=headings[i-1]+1),'Heading order '+route);
      if(route!=='/contact.html') assert.equal(await page.locator('astro-island').count(),0,'Unneeded hydration '+route);
      if(width===375||width===1440) {
        const failures=await page.evaluate(()=>{
          const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>s.startsWith('color(srgb')?n:n/255);
          const lum=s=>rgb(s).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
          return [...document.querySelectorAll('main h1,main h2,main h3,main h4,main p,main label,main .btn,main .leader-phone,.navbar a,.footer-columns p')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').flatMap(e=>{
            let p=e;while(p.parentElement&&getComputedStyle(p).backgroundColor==='rgba(0, 0, 0, 0)')p=p.parentElement;
            const a=lum(getComputedStyle(e).color),b=lum(getComputedStyle(p).backgroundColor),r=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
            const css=getComputedStyle(e),large=parseFloat(css.fontSize)>=24||(parseFloat(css.fontSize)>=18.66&&parseFloat(css.fontWeight)>=700);
            return r>=(large?3:4.5)?[]:[{text:e.textContent.trim().slice(0,30),ratio:r}];
          });
        });
        assert.deepEqual(failures,[],route+' contrast');
      }
      if(width===375) for(const href of await page.locator('main a[href]').evaluateAll(es=>es.map(e=>e.getAttribute('href')))) {
        if(href.startsWith('#')) assert.equal(await page.locator(href).count(),1,href);
        else if(href.startsWith('/')&&!href.startsWith('/api/')) links.add(href.split('#')[0].split('?')[0]);
      }
      await page.evaluate(()=>scrollTo(0,0));
      if([320,1024,1920].includes(width)&&['/','/activiteiten.html','/kamp.html','/privacy.html','/groepen/ribbels/'].includes(route)) await page.screenshot({path:'.test-artifacts/phase6/final-'+(route==='/'?'home':route.slice(1).replaceAll('/','-').replace('.html',''))+'-'+width+'.png',fullPage:true});
      if(route==='/') metrics.push({width,...await page.evaluate(()=>({...window.__quality,resources:performance.getEntriesByType('resource').length,bytes:performance.getEntriesByType('resource').reduce((n,e)=>n+e.transferSize,0)}))});
    }
    await page.goto(base+'/');
    if(width<1100) {
      await page.getByRole('button',{name:'Menu openen',exact:true}).click();
      assert.equal(await page.locator('#mobile-nav').evaluate(e=>e.open),true);
      await page.keyboard.press('Shift+Tab');assert.ok(await page.locator('#mobile-nav').evaluate(e=>e.contains(document.activeElement)));
      await page.keyboard.press('Tab'); assert.equal(await page.locator('#mobile-close').evaluate(e=>e===document.activeElement),true);
      await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('#burger').getAttribute('aria-expanded')==='false');assert.equal(await page.locator('#burger').getAttribute('aria-expanded'),'false');
      assert.equal(await page.locator('#burger').evaluate(e=>e===document.activeElement),true);
      await page.getByRole('button',{name:'Menu openen',exact:true}).click();
      await page.locator('#mobile-nav a[href="/inschrijven.html"]').click();await page.waitForURL('**/inschrijven.html');
      assert.equal(await page.locator('#mobile-nav').evaluate(e=>e.open),false);
    } else {
      await page.locator('.nav-dropdown summary').focus(); await page.keyboard.press('Enter');assert.equal(await page.locator('.nav-dropdown').evaluate(e=>e.open),true);
      await page.keyboard.press('Escape');assert.equal(await page.locator('.nav-dropdown').evaluate(e=>e.open),false);
    }
    console.log('PASS '+width+'px: 19 routes, headings/metadata, images, no overflow/clipping, navigation/keyboard');
  }
  for(const path of links) assert.equal((await context.request.get(base+path)).status(),200,'Internal link '+path);
  let sitemap=await context.request.get(base+'/sitemap.xml'); assert.equal(sitemap.status(),200);
  assert.ok(sitemap.headers()['content-type'].includes('application/xml'));
  let xml=await sitemap.text();assert.equal((xml.match(/<loc>/g)||[]).length,routes.length);
  for(const route of routes)assert.ok(xml.includes('https://www.chironegenmanneke.be'+route),route);
  assert.ok(!/leiding-login|api\/|netlify-form|admin|auth|app\//.test(xml));
  if(reads) {
    mode='populated'; xml=await (await context.request.get(base+'/sitemap.xml')).text();
    assert.ok(xml.includes('/groepen/cms-testgroep/'));assert.ok(!xml.includes('/groepen/ribbels/')); mode='empty';
  }
  const robots=await (await context.request.get(base+'/robots.txt')).text();assert.ok(robots.includes('Sitemap: https://www.chironegenmanneke.be/sitemap.xml'));
  await page.goto(base+'/');await page.keyboard.press('Tab');assert.equal(await page.locator('.skip-link').evaluate(e=>e===document.activeElement),true);
  await page.keyboard.press('Enter');assert.equal(await page.locator('main').evaluate(e=>e===document.activeElement),true);
  await page.setViewportSize({width:375,height:900});await page.getByRole('button',{name:'Menu openen',exact:true}).click();
  await page.setViewportSize({width:1440,height:900});await page.waitForFunction(()=>!document.querySelector('#mobile-nav').open);assert.equal(await page.locator('#mobile-nav').evaluate(e=>e.open),false);
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.btn').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
  const nojs=await browser.newContext({javaScriptEnabled:false,viewport:{width:320,height:900}});
  await nojs.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());const plain=await nojs.newPage();await plain.goto(base+'/');
  assert.equal(await plain.locator('.nav-fallback a[href="/inschrijven.html"]').isVisible(),true);assert.equal(await plain.locator('#burger').isVisible(),false);
  await nojs.close();
  assert.deepEqual(errors,[]);
  const {writeFileSync}=await import('node:fs');writeFileSync('.test-artifacts/phase6/local-metrics.json',JSON.stringify(metrics,null,2));
  console.log('PASS internal links, sitemap/CMS/privacy boundaries, skip/focus/menu resize/no-JS/reduced motion, contrast; zero page errors. Local timings are not production Web Vitals.');
} finally {
  await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());globalThis.fetch=realFetch;
}
