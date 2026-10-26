import { marked } from 'marked';
import { load } from 'cheerio';
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
const types = { '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };
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

  const normalize = value => value.replace(/\s+/g,'');
  const plainText = value => normalize(load(marked.parse(value)).text());
  const routes=['/','/groepen.html','/leiding.html','/activiteiten.html','/inschrijven.html','/kamp.html','/contact.html','/chiroliedjes.html','/verhuur.html','/verzekering.html','/privacy.html','/praktisch.html','/geschiedenis.html',...content.groups.map(g=>'/groepen/'+g.slug+'/')];
  for (const width of [375,768,1440]) {
    await page.setViewportSize({width,height:900});
    for (const route of routes) {
      assert.equal((await page.goto(base+route)).status(),200,route);
      assert.equal(await page.locator('main h1').count(),1,route);
      for (const img of await page.locator('main img').all()) { await img.scrollIntoViewIfNeeded(); await img.evaluate(e=>e.decode()); }
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+'px overflow '+route);
      if(!await page.locator('.info-page').count()) continue;
      for(const link of await page.locator('.info-page a[href^="#"]').all()) {
        const hash=await link.getAttribute('href'); assert.equal(await page.locator(hash).count(),1,route+' '+hash);
      }
      if(['/privacy.html','/verzekering.html','/verhuur.html'].includes(route)) {
        const key={'/privacy.html':'privacy','/verzekering.html':'insurance','/verhuur.html':'rental'}[route];
        const sections=page.locator('.reading-section .markdown');
        assert.equal(await sections.count(),content.pages[key].cards.length);
        for(let i=0;i<await sections.count();i++) assert.equal(normalize(await sections.nth(i).textContent()),plainText(content.pages[key].cards[i].body),key+' unchanged text '+i);
      }
      if(route==='/geschiedenis.html') assert.equal(normalize(await page.locator('.history-story .markdown').textContent()),plainText(content.pages.home.history.body));
      if(route==='/inschrijven.html') {
        assert.deepEqual(await page.locator('.registration-steps li').allTextContents(),content.pages.registration.steps);
        assert.deepEqual(await page.locator('.merch-prices li').allTextContents(),content.pages.registration.merch.prices);
        assert.equal(await page.locator('main form').count(),0);
        assert.equal(await page.locator('.registration-groups tbody tr').count(),content.groups.length);
        assert.deepEqual(await page.locator('.merch-info .info-actions a').evaluateAll(es=>es.map(e=>e.getAttribute('href'))),content.pages.registration.merch.actions.map(a=>a.href));
      }
      if(route==='/kamp.html') {
        assert.equal(await page.locator('a').filter({hasText:content.pages.camp.signupLinkLabel}).last().getAttribute('href'),content.pages.camp.signupLinkUrl);
        const text=normalize(await page.locator('main').textContent());
        assert.ok(text.includes(normalize(content.pages.camp.bankAccount)));
        for(const item of content.pages.camp.priceItems) assert.ok(text.includes(normalize(item.value)), 'camp price');
      }
      if(route==='/contact.html') {
        assert.equal(await page.locator('form[name="contact"]').count(),2);
        for(const name of ['naam','email','onderwerp','categorie','bericht','website']) assert.ok(await page.locator('form[name="contact"] [name="'+name+'"]').count()>=1,name);
        const text=normalize(await page.locator('.contact-directory-section').textContent());
        for(const group of content.groups) for(const person of group.leaders) {assert.ok(text.includes(normalize(person.name)));if(person.phone) assert.ok(text.includes(normalize(person.phone)));}
      }
      if(route==='/chiroliedjes.html') {
        assert.deepEqual(await page.locator('.song-title').allTextContents(),content.songs.map(s=>s.title));
        assert.deepEqual(await page.locator('.lyrics').allTextContents(),content.songs.map(s=>s.lyrics));
        await page.locator('.song summary').first().focus(); await page.keyboard.press('Enter');
        assert.equal(await page.locator('.song').first().getAttribute('open'),'');
      }
      const failures=await page.evaluate(()=>{
        const lum=s=>{const v=s.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>s.startsWith('color(srgb')?n:n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return v.reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0);};
        return [...document.querySelectorAll('.info-page h1,.info-page h2,.info-page .info-lead,.info-page .info-kicker,.info-page .info-facts dt,.info-page .merch-prices li,.info-page label,.info-page .contact-form-note,.info-page .song-count,.info-page .camp-card-kicker,.info-page .camp-pill span')].filter(e=>e.getClientRects().length).flatMap(e=>{
          let p=e;while(p.parentElement&&getComputedStyle(p).backgroundColor==='rgba(0, 0, 0, 0)') p=p.parentElement;
          const a=lum(getComputedStyle(e).color),b=lum(getComputedStyle(p).backgroundColor),r=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
          return r>=4.5?[]:[{text:e.textContent.trim().slice(0,25),ratio:r}];
        });
      });
      assert.deepEqual(failures,[],route+' text contrast');
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:'.test-artifacts/phase5/'+route.slice(1).replace('.html','')+'-'+width+'.png',fullPage:true});
    }
    console.log('PASS '+width+'px: 19 public routes, images, anchors, no overflow, original legal/history/lyrics, signup/clothing/camp sources');
  }
  await page.goto(base+'/chiroliedjes.html');
  await page.getByLabel('Zoek op titel of liedtekst').fill(content.songs[0].title);
  await page.getByRole('button',{name:'Zoek liedjes'}).click(); await page.waitForURL('**/chiroliedjes.html?*');
  assert.ok(await page.locator('.song').count()>0);
  await page.getByLabel('Zoek op titel of liedtekst').fill('GEEN-BESTAAND-LIED-12345');
  await page.getByRole('button',{name:'Zoek liedjes'}).click(); await page.waitForURL('**zoek=GEEN*');
  assert.equal(await page.locator('.song').count(),0);
  await page.getByRole('link',{name:'Alle liedjes tonen',exact:true}).first().click();
  assert.equal(await page.locator('.song').count(),content.songs.length);
  const nojs=await browser.newContext({javaScriptEnabled:false,viewport:{width:375,height:900}});
  await nojs.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  const plain=await nojs.newPage(); await plain.goto(base+'/chiroliedjes.html');
  await plain.getByLabel('Zoek op titel of liedtekst').fill(content.songs[0].title);
  await plain.getByRole('button',{name:'Zoek liedjes'}).click(); await plain.waitForURL('**/chiroliedjes.html?*');
  assert.ok(await plain.locator('.song').count()>0); await nojs.close();
  await page.getByLabel('Zoek op titel of liedtekst').focus();
  assert.equal(await page.getByLabel('Zoek op titel of liedtekst').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.ok(await page.locator('.btn').first().evaluate(e=>parseFloat(getComputedStyle(e).transitionDuration)<=.00001));
  if(reads) {
    mode='populated';
    for(const [route,title] of [['inschrijven','CMS inschrijven controle'],['kamp','CMS kamp controle'],['privacy','CMS privacy controle']]) {
      await page.goto(base+'/'+route+'.html'); assert.equal(await page.locator('main h1').innerText(),title);
    }
    await page.goto(base+'/geschiedenis.html'); assert.equal(await page.locator('.history-story .markdown').innerText(),'CMS geschiedenis controle');
    mode='fallback';
    assert.equal((await page.goto(base+'/praktisch.html')).status(),200);
    assert.ok((await page.locator('.info-facts').innerText()).includes(content.pages.home.practical.items[0].split(':').slice(1).join(':').trim()));
    console.log('PASS populated CMS fields and unavailable-CMS JSON fallback');
  } else console.log('SKIP CMS fixtures: no Supabase config');
  assert.deepEqual(errors,[]);
  console.log('PASS song search/reset/no-JS, keyboard disclosure, focus/reduced motion, zero page errors; external traffic blocked');
} finally {
  await browser?.close(); await new Promise(resolve=>server?server.close(resolve):resolve()); globalThis.fetch=realFetch;
}
