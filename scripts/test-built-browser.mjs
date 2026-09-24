import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, sep, extname } from "node:path";
import { chromium } from "playwright-core";

// Exercise the actual Netlify bundle and Astro/Preact hydration, not Vite fixtures.
// All Supabase reads and form submissions are simulated; no messages are sent.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_input, init) => {
  assert.equal(init?.method ?? "GET", "GET", "No external mutation allowed");
  return Response.json([]);
};
const root = resolve("dist");
const types = { ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
let server, browser;
try {
  const { default: handler } = await import("../.netlify/v1/functions/ssr/ssr.mjs");
  server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, "GET", "Browser mutations must be intercepted");
      const url = new URL(req.url, `http://${req.headers.host}`);
      const file = resolve(root, "." + decodeURIComponent(url.pathname));
      if (file.startsWith(root + sep) && await stat(file).then(s => s.isFile()).catch(() => false)) {
        res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
        res.end(await readFile(file));
        return;
      }
      const response = await handler(new Request(url), { ip: "127.0.0.1" });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(error);
      res.writeHead(500); res.end("Test server error");
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.PWA_BROWSER_PATH ?? ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(existsSync);
  assert.ok(executablePath, "Set PWA_BROWSER_PATH to a Chromium browser");
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    if (new URL(route.request().url()).origin !== base) return route.abort();
    await route.continue();
  });
  await page.goto(base + "/leiding-login/?app=home");
  await page.getByLabel("E-mail", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll("astro-island[ssr]").length === 0);
  assert.equal(await page.getByRole("button", { name: "Inloggen", exact: true }).isEnabled(), true);
  mkdirSync(".test-artifacts", { recursive: true });
  await page.screenshot({ path: ".test-artifacts/built-login-desktop.png", fullPage: true });
  await page.goto(base + "/contact.html");
  await page.waitForFunction(() => document.querySelectorAll("astro-island[ssr]").length === 0);
  let stalled = false, submissions = 0;
  await page.route("**/netlify-form/", route => route.fulfill({ status: 200, headers: { "x-nf-request-id": "fixture" }, body: "ok" }));
  await page.route("**/api/contact", route => {
    submissions++;
    if (stalled) return;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: "Message de test enregistré" }) });
  });
  async function fillContact() {
    await page.getByLabel("Uw naam", { exact: false }).fill("Test local");
    await page.getByLabel("Uw e-mailadres", { exact: false }).fill("test@example.test");
    await page.getByLabel("Onderwerp", { exact: false }).fill("Test simulé");
    await page.getByLabel("Bericht", { exact: false }).fill("Aucun message réel ne doit être envoyé.");
  }
  await fillContact();
  await page.getByRole("button", { name: "Verstuur", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Message de test enregistré" }).waitFor();
  assert.equal(await page.getByLabel("Uw naam", { exact: false }).inputValue(), "");
  stalled = true;
  await fillContact();
  await page.getByRole("button", { name: "Verstuur", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("button", { name: "Verstuur", exact: true }).isEnabled(), true);
  assert.equal(submissions, 2);
  assert.equal(await page.getByLabel("Uw naam", { exact: false }).inputValue(), "Test local");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: ".test-artifacts/built-contact-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("Built browser passed: official Astro/Preact hydration, desktop login, simulated contact success/stall/retry state and mobile layout; no real email or database write.");
} finally {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  globalThis.fetch = originalFetch;
}
