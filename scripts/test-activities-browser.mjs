import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, readdir } from 'node:fs/promises';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, sep, dirname, basename, extname } from 'node:path';
import { chromium } from 'playwright-core';

// Read-only local fixtures; no production network or database mutations.
const content = JSON.parse(readFileSync(new URL('../src/data/default-content.json', import.meta.url), 'utf8'));
let mode = 'empty', reads = 0, projectOrigin = '';
const posts = [
  { id: 'featured', title: 'Kampnieuws', summary: 'Een uitgelicht bericht.', body: '**Volledige tekst**\n\n![Kampfoto](/assets/kampfoto.jpg)\n\n[Contact](/contact.html)\n\nLaatste alinea blijft zichtbaar.', event_date: '2026-10-26', created_at: '2026-10-20T08:00:00Z', published: true, featured: true },
  { id: 'ordinary', title: 'Zondag met laarzen', summary: '', body: 'Neem je laarzen mee.\n\n![Banner](/assets/banner.jpg)', event_date: '2026-09-15', created_at: '2026-09-10T08:00:00Z', published: true, featured: false },
  { id: 'created', title: 'Café bij de Chiro', summary: '', body: 'Nieuws zonder redactionele datum.', event_date: null, created_at: '2026-12-31T23:30:00Z', published: true, featured: false },
  { id: 'undated', title: 'Bericht zonder datum', summary: '', body: 'Wel inhoud, geen datum.', event_date: null, created_at: null, published: true, featured: false },
  { id: 'draft', title: 'CONCEPT-NIET-PUBLIEK', summary: '', body: 'Niet gepubliceerd.', event_date: '2026-08-01', created_at: '2026-08-01T12:00:00Z', published: false, featured: true }
];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  assert.equal(init?.method ?? 'GET', 'GET', 'External mutation forbidden');
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname.includes('/rest/v1/')) { projectOrigin = url.origin; reads++; }
  if (mode === 'fallback') return Response.json({ message: 'Simulated unavailable CMS' }, { status: 503 });
  if (url.pathname.includes('/storage/v1/object/public/site-media/')) return new Response('%PDF-1.4 local fixture', { headers: { 'Content-Type': 'application/pdf' } });
  if (mode === 'populated') {
    if (url.pathname.endsWith('/posts')) return Response.json(posts);
    if (url.pathname.endsWith('/page_content')) return Response.json([{ slug: 'activities', data: { ...content.pages.activities, bookletUrl: `${projectOrigin}/storage/v1/object/public/site-media/test-booklet.pdf`, bookletFileName: 'lokaal-boekje.pdf' } }]);
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
  mkdirSync('.test-artifacts/phase4', { recursive: true });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    mode = 'empty';
    assert.equal((await page.goto(base + '/activiteiten.html')).status(), 200);
    assert.equal(await page.locator('h1').innerText(), content.pages.activities.title);
    assert.equal(await page.locator('.activities-empty').isVisible(), true);
    assert.equal(await page.locator('.activities-filters').count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Download het boekje' }).count(), 0);
    assert.ok((await page.locator('.activities-info').innerText()).includes('De kalender verandert doorheen het jaar.'));
    await page.screenshot({ path: `.test-artifacts/phase4/empty-${width}.png`, fullPage: true });
    if (!reads) continue;
    mode = 'populated';
    await page.goto(base + '/activiteiten.html');
    assert.equal(await page.locator('.activities-posts .post-card').count(), 4);
    assert.equal(await page.getByText('CONCEPT-NIET-PUBLIEK').count(), 0);
    assert.equal(await page.locator('#post-featured strong').filter({ hasText: 'Volledige tekst' }).count(), 1);
    assert.ok((await page.locator('#post-featured').innerText()).includes('Laatste alinea blijft zichtbaar.'));
    assert.equal(await page.locator('#post-undated time').count(), 0);
    assert.equal(await page.locator('#post-created time').innerText(), '1 januari 2027');
    assert.ok((await page.locator('#post-created .post-date').innerText()).includes('Aangemaakt op'));
    for (const image of await page.locator('.activities-posts img').all()) { await image.scrollIntoViewIfNeeded(); await image.evaluate(e => e.decode()); }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px overflow`);
    const contrastFailures = await page.evaluate(() => {
      const rgb = s => s.match(/[\d.]+/g).slice(0,3).map(n=>Number(n)*(s.startsWith('color(srgb')?255:1));
      const lum = c => c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
      return [...document.querySelectorAll('.activities-hero h1,.activities-info-panel h2,.activities-feed-note,.activities-filters label,.post-date,.post-date-label,.post-date-stamp strong,.post-date-stamp span,.post-date-stamp small,.post-card h3,.post-permalink,.activities-contact h2')].filter(e=>e.getClientRects().length).flatMap(e=>{
        let p=e;while(p.parentElement&&getComputedStyle(p).backgroundColor==='rgba(0, 0, 0, 0)')p=p.parentElement;
        const a=lum(rgb(getComputedStyle(e).color)),b=lum(rgb(getComputedStyle(p).backgroundColor)),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        return ratio>=4.5?[]:[{text:e.textContent.trim().slice(0,40),ratio}];
      });
    });
    assert.deepEqual(contrastFailures, []);
    await page.evaluate(() => scrollTo(0,0));
    await page.screenshot({ path: `.test-artifacts/phase4/populated-${width}.png`, fullPage: true });
    await page.screenshot({ path: `.test-artifacts/phase4/hero-${width}.png` });
    await page.getByLabel('Zoek een bericht', {exact:true}).fill('laarzen');
    await page.getByLabel('Maand van het bericht', {exact:true}).selectOption('2026-09');
    await page.getByRole('button', {name:'Toon berichten'}).click();
    await page.waitForURL('**/activiteiten.html?*');
    assert.equal(await page.locator('.post-card-full').count(), 1);
    assert.equal(await page.locator('.post-card-full').getAttribute('id'), 'post-ordinary');
    assert.equal(new URL(await page.locator('link[rel="canonical"]').getAttribute('href')).pathname, '/activiteiten.html');
    await page.getByRole('link', {name:'Alle berichten tonen',exact:true}).click();
    await page.getByLabel('Alleen uitgelicht').check();
    await page.getByRole('button', {name:'Toon berichten'}).click();
    await page.waitForURL('**/activiteiten.html?*');
    assert.equal(await page.locator('.post-card-full').count(), 1);
    assert.equal(await page.locator('.post-card-full').getAttribute('id'), 'post-featured');
    await page.getByLabel('Zoek een bericht', {exact:true}).fill('Geen passend bericht');
    await page.getByRole('button', {name:'Toon berichten'}).click();
    await page.waitForURL('**/activiteiten.html?*');
    assert.equal(await page.getByText('Niets gevonden met deze filters').isVisible(), true);
    await page.getByRole('link', {name:'Alle berichten tonen',exact:true}).first().click();
    assert.equal(await page.locator('.post-card-full').count(), 4);
    await page.goto(base + '/');
    assert.equal(await page.locator('.home-news .post-card').count(), 1);
    assert.equal(await page.locator('.home-news .post-date time').innerText(), '26 oktober 2026');
    await page.locator('.home-news .post-read-more').click();
    await page.waitForURL('**/activiteiten.html#post-featured');
    assert.equal(await page.locator('#post-featured').isVisible(), true);
    console.log(`PASS ${width}px: empty/populated feed, full content/images, search/month/highlight/reset, homepage anchors, contrast, no overflow`);
  }
  if (reads) {
    mode = 'populated';
    await page.goto(base + '/activiteiten.html');
    assert.equal(await page.getByRole('link', {name:'Download het boekje'}).getAttribute('href'), '/api/booklet');
    assert.ok((await page.locator('.activities-info a[href="/api/booklet"]').count()) > 0);
    const pdf = await context.request.get(base + '/api/booklet');
    assert.equal(pdf.status(),200); assert.equal(pdf.headers()['content-type'],'application/pdf');
    assert.ok(pdf.headers()['content-disposition'].includes('lokaal-boekje.pdf'));
    await page.goto(base + '/activiteiten.html?maand=invalid&zoek=%3Cscript%3E');
    assert.equal(await page.locator('.post-card-full').count(),0);
    assert.equal(await page.locator('script:not([src])').filter({hasText:'<script>'}).count(),0);
    const nojs = await browser.newContext({javaScriptEnabled:false,viewport:{width:375,height:900}});
    await nojs.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const plain = await nojs.newPage(); await plain.goto(base + '/activiteiten.html');
    await plain.getByLabel('Zoek een bericht',{exact:true}).fill('CAFE');
    await plain.getByRole('button',{name:'Toon berichten'}).click();
    await plain.waitForURL('**/activiteiten.html?*');
    assert.equal(await plain.locator('.post-card-full').count(),1);
    assert.equal(await plain.locator('.post-card-full').getAttribute('id'),'post-created');
    await page.goto(base + '/activiteiten.html');
    await page.getByLabel('Zoek een bericht',{exact:true}).focus();
    assert.equal(await page.getByLabel('Zoek een bericht',{exact:true}).evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
    mode = 'fallback'; await page.goto(base + '/activiteiten.html');
    assert.equal(await page.locator('.activities-empty').isVisible(), true);
    console.log('PASS booklet endpoint with local PDF fixture, query escaping, no-JS filtering, Belgian dates, focus, unavailable-CMS fallback');
  } else console.log('SKIP CMS fixtures: no public Supabase config in this build');
  assert.deepEqual(errors,[]);
  console.log('PASS zero page errors; no production requests, database changes or deployment');
} finally {
  await browser?.close(); await new Promise(resolve=>server?server.close(resolve):resolve()); globalThis.fetch=realFetch;
}
