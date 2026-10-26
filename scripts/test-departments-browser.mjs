import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, readdir } from 'node:fs/promises';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, sep, dirname, basename, extname } from 'node:path';
import { chromium } from 'playwright-core';

// Built SSR, simulated public CMS reads and blocked external traffic. No writes.
const content = JSON.parse(readFileSync(new URL('../src/data/default-content.json', import.meta.url), 'utf8'));
const rows = content.groups.map(g => ({ ...g, theme_key: g.themeKey, age_range: g.ageRange, birth_years: g.birthYears, school_years: g.schoolYears, image_url: g.imageUrl, image_alt: g.imageAlt, sort_order: g.sortOrder }));
const changed = structuredClone(rows);
changed[0].name = 'Ribbels uit CMS'; changed[0].age_range = '7–9 jaar'; changed[0].birth_years = '2017–2019';
changed[0].leaders = [{ name: 'Testleider uit CMS', phone: '0490/12.34.56' }];
changed.push({ ...changed[0], slug: 'extra-afdeling', name: 'Extra CMS-afdeling' });
let mode = 'default', reads = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  assert.equal(init?.method ?? 'GET', 'GET', 'External writes are forbidden');
  reads++;
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (mode === 'fallback') return Response.json({ message: 'Simulated unavailable CMS' }, { status: 503 });
  if (url.pathname.endsWith('/groups')) {
    if (mode === 'changed') return Response.json(changed);
    if (mode === 'missing') return Response.json([
      { ...rows[0], image_url: '', age_range: '', birth_years: '', school_years: '', description: '', leaders: [] },
      { ...rows[1], leaders: [{ name: '', phone: '' }, { name: 'Alleen naam' }, { phone: '0490/12.34.56' }] }
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
      assert.equal(req.method, 'GET', 'Browser writes are forbidden');
      const url = new URL(req.url, `http://${req.headers.host}`);
      const file = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (file.startsWith(root + sep) && await stat(file).then(s => s.isFile()).catch(() => false)) {
        assert.ok((await readdir(dirname(file))).includes(basename(file)), `Linux asset casing: ${file}`);
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
        res.end(await readFile(file)); return;
      }
      const response = await handler(new Request(url), { ip: '127.0.0.1' });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { console.error(error); res.writeHead(500); res.end('Local verification error'); }
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
  mkdirSync('.test-artifacts/phase3', { recursive: true });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/groepen.html', '/leiding.html', ...content.groups.map(g => `/groepen/${g.slug}/`)]) {
      assert.equal((await page.goto(base + path)).status(), 200, path);
      assert.equal(await page.locator('h1').count(), 1);
      for (const image of await page.locator('.departments img').all()) { await image.scrollIntoViewIfNeeded(); await image.evaluate(e => e.decode()); }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: ${path} overflows`);
      const contrastFailures = await page.evaluate(() => {
        const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(n => Number(n) * (value.startsWith('color(srgb') ? 255 : 1));
        const luminance = color => color.map(c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((n, c, i) => n + c * [.2126, .7152, .0722][i], 0);
        return [...document.querySelectorAll('.department-preview h2, .department-preview-copy p, .department-age, .leader-card h3, .leader-card a, .leader-initials, .department-help h2, .department-help p, .departments dt, .departments dd')].filter(e => e.getClientRects().length).flatMap(e => {
          let p = e;
          while (p.parentElement && getComputedStyle(p).backgroundColor === 'rgba(0, 0, 0, 0)') p = p.parentElement;
          const foreground = luminance(rgb(getComputedStyle(e).color)), background = luminance(rgb(getComputedStyle(p).backgroundColor));
          const ratio = (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
          return ratio >= 4.5 ? [] : [{ text: e.textContent.trim().slice(0, 40), ratio }];
        });
      });
      assert.deepEqual(contrastFailures, [], `${width}: ${path} text contrast`);
      if (path.startsWith('/groepen/')) {
        const group = content.groups.find(g => path === `/groepen/${g.slug}/`);
        assert.equal(await page.locator('h1').innerText(), group.name);
        assert.equal(new URL(await page.locator('link[rel="canonical"]').getAttribute('href')).pathname, path);
        for (const leader of group.leaders) {
          assert.ok((await page.locator('.leader-cards').innerText()).includes(leader.name));
          assert.ok((await page.locator('.leader-cards').innerText()).includes(leader.phone));
        }
        assert.ok((await page.locator('.department-facts').innerText()).includes(group.birthYears));
        assert.equal(await page.locator('.department-actions .btn').getAttribute('href'), '/inschrijven.html');
      }
      if (['/groepen.html', '/leiding.html', '/groepen/rakwi/', '/groepen/speelclub/'].includes(path)) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: `.test-artifacts/phase3/${path.replaceAll('/', '').replace('.html', '')}-${width}.png`, fullPage: true });
        await page.screenshot({ path: `.test-artifacts/phase3/viewport-${path.replaceAll('/', '').replace('.html', '')}-${width}.png` });
      }
    }
    await page.goto(base + '/');
    assert.equal(await page.locator('.home-department').count(), 6);
    for (let i = 0; i < content.groups.length; i++) assert.equal(await page.locator('.home-department').nth(i).getAttribute('href'), `/groepen/${content.groups[i].slug}/`);
    await page.locator('.home-department').first().click();
    await page.waitForURL('**/groepen/ribbels/');
    console.log(`PASS ${width}px: six details, overview, leaders, photos, original names/phones/age data and homepage links; no overflow`);
  }
  await page.goto(base + '/groepen.html');
  await page.locator('.department-preview-link').first().focus();
  assert.equal(await page.locator('.department-preview-link').first().evaluate(e => getComputedStyle(e).outlineStyle), 'solid');
  await page.keyboard.press('Enter'); await page.waitForURL('**/groepen/ribbels/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base + '/groepen.html');
  assert.equal(await page.locator('.department-preview-link').first().evaluate(e => getComputedStyle(e).transitionDuration), '0s');
  assert.equal((await page.goto(base + '/groepen/bestaat-niet/')).status(), 404);
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow');
  if (reads) {
    mode = 'changed';
    await page.goto(base + '/groepen/ribbels/');
    assert.equal(await page.locator('h1').innerText(), changed[0].name);
    assert.equal(await page.locator('.department-hero .department-age').innerText(), '7–9 jaar');
    assert.equal(await page.locator('.leader-card h3').innerText(), changed[0].leaders[0].name);
    assert.equal(await page.locator('.leader-card a').getAttribute('href'), 'tel:0490123456');
    assert.equal((await page.goto(base + '/groepen/extra-afdeling/')).status(), 200);
    await page.goto(base + '/leiding.html');
    assert.ok((await page.locator('#ribbels').innerText()).includes(changed[0].leaders[0].name));
    await page.goto(base + '/contact.html');
    assert.ok((await page.locator('.contact-card-people').allInnerTexts()).join(' ').includes(changed[0].leaders[0].name));
    await page.goto(base + '/inschrijven.html');
    assert.equal(await page.locator('tbody tr').first().locator('a').getAttribute('href'), '/groepen/ribbels/');
    assert.ok((await page.locator('tbody').innerText()).includes(changed[0].birth_years));
    await page.goto(base + '/');
    assert.equal(await page.locator('.home-department').count(), 7);
    assert.equal(await page.locator('.home-department-age').first().innerText(), '7–9 jaar');
    mode = 'missing';
    await page.goto(base + '/groepen/ribbels/');
    assert.equal(await page.locator('.department-image-empty').count(), 1);
    assert.equal(await page.locator('.leaders-empty').count(), 1);
    assert.equal(await page.locator('.department-facts').count(), 0);
    await page.goto(base + '/groepen/speelclub/');
    assert.equal(await page.locator('.leader-card').count(), 2);
    assert.equal((await page.goto(base + '/groepen/aspi/')).status(), 404, 'Removed groups must not appear as fallback details');
    mode = 'fallback';
    for (const group of content.groups) assert.equal((await page.goto(base + `/groepen/${group.slug}/`)).status(), 200);
    console.log('PASS simulated CMS updates, extra group, shared contact/registration/home data, missing image/leaders/age, removed/unknown group 404, unavailable-CMS fallback');
  } else console.log('SKIP CMS-specific fixtures: build has no public Supabase configuration; fallback routes verified');
  const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 900 } });
  await nojs.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const fallback = await nojs.newPage(); await fallback.goto(base + '/groepen/ribbels/');
  assert.equal(await fallback.locator('h1').isVisible(), true);
  assert.equal(await fallback.locator('.leader-card').count(), content.groups[0].leaders.length);
  assert.deepEqual(errors, []);
  console.log('PASS keyboard navigation, focus, reduced motion and no-JS rendering; zero page errors, no external writes or deployment');
} finally {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  globalThis.fetch = realFetch;
}
