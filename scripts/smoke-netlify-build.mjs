import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadEnv } from "vite";

// Exercise the packaged function, not `astro dev`. No deployed service is called:
// public Supabase reads receive empty data, and any attempted mutation fails.
const realFetch = globalThis.fetch;
let renderCase = "";
let publicReads = 0;
globalThis.fetch = async (input, init) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  assert.equal(method, "GET", "Build smoke must not make external mutations");
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname.endsWith("/rest/v1/page_content")) {
    publicReads++;
    if (renderCase) {
      const home = JSON.parse(readFileSync(new URL("../src/data/default-content.json", import.meta.url), "utf8")).pages.home;
      if (renderCase === "unsafe") {
        home.about.body = '<script>unsafe-smoke-payload</script><a href="javascript:unsafe-smoke-payload">Link</a><strong>Safe smoke text</strong>';
      } else {
        // Fail in page frontmatter, before streaming commits the HTTP headers.
        home.banner.primaryCtaHref = { invalidLink: true };
      }
      return Response.json([{ slug: "home", data: home }]);
    }
  }
  return Response.json([]);
};

try {
  const { default: handler, config } = await import("../.netlify/v1/functions/ssr/ssr.mjs");
  assert.equal(config.path, "/*", "Netlify must route requests to Astro SSR");
  assert.equal(config.preferStatic, true, "Assets and the static Forms document remain accessible");
  const env = { ...loadEnv("production", process.cwd(), ""), ...process.env };
  const slug = (env.ADMIN_PATH_SLUG ?? "").trim().toLowerCase()
    .replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "leiding-login";
  const origin = "https://www.chironegenmanneke.be";
  const request = (path, init) => handler(new Request(origin + path, init), { ip: "127.0.0.1" });
  const pages = [
    ["/", "Officiële site"], ["/activiteiten.html", "Activiteiten"],
    ["/groepen.html", "Groepen"], ["/contact.html", "Contact"],
    ["/chiroliedjes.html", "Chiroliedjes"], ["/inschrijven.html", "Inschrijven"],
    ["/kamp.html", "Kamp"], ["/verhuur.html", "Verhuur"],
    ["/verzekering.html", "Verzekering"], ["/privacy.html", "Privacy"]
  ];
  for (const [path, title] of pages) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path}: generated SSR must return 200`);
    const html = await response.text();
    assert.ok(html.match(/<title>(.*?)<\/title>/s)?.[1].includes(title), `${path}: wrong page rendered`);
    assert.doesNotMatch(html, /Pagina niet gevonden|rel=["']manifest["']/);
    console.log(`SSR 200 ${path}`);
  }
  for (const path of [`/${slug}/`, `/${slug}/auth-action/`, ...["home", "agenda", "tasks", "finance", "members", "settings", "notifications"].map(screen => `/${slug}/?app=${screen}`)]) {
    const response = await request(path);
    assert.equal(response.status, 200, "Admin/Auth/APP route");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(await response.text(), /Pagina niet gevonden/);
  }
  assert.equal((await request("/not-a-configured-admin-smoke/")).status, 404);
  // An invalid admin request must not poison a subsequent home request.
  assert.equal((await request("/")).status, 200);
  const serverError = await request("/500");
  assert.equal(serverError.status, 500, "Server errors must not become admin 404s");
  assert.equal(serverError.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await serverError.text(), /Pagina niet gevonden|ERR_REQUIRE_ESM|node_modules/);
  if (publicReads > 0) {
    renderCase = "unsafe";
    const safe = await request("/");
    assert.equal(safe.status, 200);
    const safeHtml = await safe.text();
    assert.match(safeHtml, /<strong>Safe smoke text<\/strong>/);
    assert.doesNotMatch(safeHtml, /unsafe-smoke-payload/);
    renderCase = "broken";
    const realError = console.error;
    let loggedError = false;
    try {
      console.error = () => { loggedError = true; };
      const failed = await request("/");
      assert.equal(failed.status, 500, "Rendering exceptions retain their real HTTP status");
      assert.match(await failed.text(), /tijdelijk niet beschikbaar/);
      assert.ok(loggedError, "The server retains an error diagnostic");
    } finally {
      console.error = realError;
      renderCase = "";
    }
    console.log("SSR sanitizer and rendering-error fallback passed with simulated CMS content.");
  }
  const booklet = await request("/api/booklet");
  assert.equal(booklet.status, 404, "Booklet with empty content has no document");
  const contact = await request("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(contact.status, 400, "Contact validation must reach the API handler");
  for (const path of ["/api/admin/invite", "/api/admin/team/remove", "/api/app/invite"]) {
    const response = await request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.ok([401, 500, 503].includes(response.status), "Unauthenticated API / missing local config");
    assert.match(response.headers.get("content-type"), /application\/json/);
  }
  const form = readFileSync(new URL("../dist/netlify-form/index.html", import.meta.url), "utf8");
  assert.match(form, /data-netlify=["']true["']/);
  assert.match(form, /name=["']form-name["'] value=["']contact["']/);
  const redirects = readFileSync(new URL("../dist/_redirects", import.meta.url), "utf8");
  assert.doesNotMatch(redirects, /^\s*\/\*\s+\/index\.html\s+200/m, "No SPA catch-all over SSR/API routes");
  assert.match(readFileSync(new URL("../netlify/functions/notifications-tick.ts", import.meta.url), "utf8"), /schedule:\s*["']\* \* \* \* \*["']/);
  console.log("Packaged Netlify SSR smoke passed: 10 public pages, Admin/Auth/APP, API validation, Forms and routing configuration. External requests mocked; no deploy.");
} finally {
  globalThis.fetch = realFetch;
}
