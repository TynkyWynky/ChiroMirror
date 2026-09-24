import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Reserve an available loopback port; never use a production URL or credentials.
const reservation = createServer();
await new Promise((resolve, reject) => {
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", resolve);
});
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const astroPackage = JSON.parse(readFileSync(new URL("../node_modules/astro/package.json", import.meta.url), "utf8"));
const astroBin = new URL(`../node_modules/astro/${astroPackage.bin.astro}`, import.meta.url);
const server = spawn(process.execPath, [fileURLToPath(astroBin), "dev", "--host", "127.0.0.1", "--port", String(port)], {
  env: {
    ...process.env,
    PUBLIC_SUPABASE_URL: "", PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "",
    ADMIN_PATH_SLUG: "leiding-login", ASTRO_TELEMETRY_DISABLED: "1"
  },
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true
});
let output = "";
server.stdout.on("data", chunk => { output = (output + chunk).slice(-8000); });
server.stderr.on("data", chunk => { output = (output + chunk).slice(-8000); });
const base = `http://127.0.0.1:${port}`;

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error("Local Astro server exited.");
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) { ready = true; break; }
    } catch { /* Startup is still in progress. */ }
    await delay(500);
  }
  assert.ok(ready, "Local Astro server ready");
  for (const route of [
    "/", "/activiteiten.html", "/groepen.html", "/contact.html", "/chiroliedjes.html",
    "/inschrijven.html", "/kamp.html", "/verhuur.html", "/verzekering.html", "/privacy.html",
    "/leiding-login/", "/leiding-login/auth-action/"
  ]) {
    const response = await fetch(base + route, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, route);
    assert.match(await response.text(), /<html[^>]*lang="nl"/);
    console.log(`200 ${route}`);
  }
  assert.equal((await fetch(base + "/wrong-admin/")).status, 404);
  assert.equal((await fetch(base + "/api/booklet")).status, 404);
  for (const body of ["null", "[]", "true", '"text"', "{}", "{invalid"]) {
    const response = await fetch(base + "/api/contact", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
      signal: AbortSignal.timeout(10000)
    });
    assert.equal(response.status, 400, `Contact rejects malformed payload: ${body}`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-type"), /application\/json/);
  }
  const wrongFormat = await fetch(base + "/api/contact", {
    method: "POST", headers: { "Content-Type": "text/plain", Origin: base }, body: "{}"
  });
  assert.equal(wrongFormat.status, 415);
  const foreignOrigin = await fetch(base + "/api/contact", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://other.example" }, body: "{}"
  });
  assert.equal(foreignOrigin.status, 403);
  const honeypot = await fetch(base + "/api/contact", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ website: "spam" })
  });
  assert.equal(honeypot.status, 200, "Honeypot succeeds without sending or storing anything");
  const sw = await fetch(base + "/leiding-login/push-sw.js");
  assert.equal(sw.status, 200); assert.match(sw.headers.get("content-type"), /javascript/);
  assert.equal(sw.headers.get("service-worker-allowed"), "/leiding-login/"); assert.equal(sw.headers.get("cache-control"), "no-store");
  const swText = await sw.text(); assert.ok(swText.includes('addEventListener("push"')); assert.ok(swText.includes('request.mode !== "navigate"')); assert.ok(swText.includes('const APP_BUILD = "app-'));
  const manifest = await fetch(base + "/leiding-login/manifest.webmanifest"); assert.equal(manifest.status, 200);
  const manifestData=await manifest.json();assert.equal(manifestData.scope, "/leiding-login/");assert.equal(manifestData.start_url,"/leiding-login/?app=home");assert.equal(manifestData.id,"/chiro-negenmanneke-app");
  assert.equal((await fetch(base + "/wrong-admin/push-sw.js")).status, 404);
  assert.equal((await fetch(base + "/wrong-admin/manifest.webmanifest")).status, 404);
  const offline=await fetch(base+"/leiding-login/offline.html");assert.equal(offline.status,200);assert.equal(offline.headers.get("X-Chiro-Offline"),"1");assert.match(await offline.text(),/Geen internetverbinding/);
  assert.equal((await fetch(base+"/wrong-admin/offline.html")).status,404);
  for(const icon of [...manifestData.icons.map(icon=>icon.src),"/assets/app/apple-touch-icon.png"]){const response=await fetch(base+icon);assert.equal(response.status,200);assert.match(response.headers.get("content-type"),/image\/png/);}
  const publicHtml=await(await fetch(base+"/")).text();assert.ok(!/rel=["']manifest/.test(publicHtml));
  console.log("Local HTTP checks passed (public site, APP manifest/icons, scoped worker, offline fallback and invalid contact requests; no Supabase connection).");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  server.kill();
}
