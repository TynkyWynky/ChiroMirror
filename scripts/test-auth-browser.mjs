// Real production components and installed Supabase SDK; only HTTP is simulated.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
const api = "https://auth.fixture.test";
const user = { id: "00000000-0000-0000-0000-000000000001", email: "member@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture-signature`;
const session = { access_token: token, refresh_token: "fixture-refresh-token", token_type: "bearer", expires_in: 3600, user };
let server, browser;
const errors = [];
try {
  server = await createServer({ configFile: false, root: `${root}/tests/fixtures/auth`,
    resolve: { alias: { "@": `${root}/src` } },
    define: { "import.meta.env.PUBLIC_SUPABASE_URL": JSON.stringify(api), "import.meta.env.PUBLIC_SUPABASE_ANON_KEY": JSON.stringify("fixture-anon"), "import.meta.env.PUBLIC_APP_BUILD": JSON.stringify("auth-fixture") },
    esbuild: { jsx: "automatic", jsxImportSource: "preact" },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } }
  });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const executablePath = process.env.AUTH_BROWSER_PATH ?? ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(existsSync);
  assert.ok(executablePath, "Set AUTH_BROWSER_PATH to a Chromium browser executable.");
  browser = await chromium.launch({ executablePath, headless: true });

  async function fixture({ siteRole = "none", missingApp = false, blockedStorage = false, stall = "" } = {}) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("pageerror", error => errors.push(error.message));
    const state = { stall, exchanges: 0, logins: 0, badPassword: false };
    if (blockedStorage) await page.addInitScript(() => {
      Storage.prototype.getItem = Storage.prototype.setItem = Storage.prototype.removeItem = () => { throw new DOMException("Storage blocked", "SecurityError"); };
    });
    await page.route(api + "/**", async route => {
      const request = route.request(), url = new URL(request.url());
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname === "/auth/v1/token") {
        if (url.searchParams.get("grant_type") === "pkce") state.exchanges++;
        else state.logins++;
        if (state.stall === "login") return;
        if (state.badPassword) return json({ code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
        return json(session);
      }
      if (url.pathname === "/auth/v1/user") return json(user);
      if (url.pathname === "/auth/v1/logout" || url.pathname === "/auth/v1/recover") return json({});
      if (url.pathname === "/rest/v1/profiles") {
        if (state.stall === "profile") return;
        const profile = { user_id: user.id, email: user.email, full_name: "Test member", role: siteRole, managed_group_slugs: [], created_at: user.created_at };
        return json(url.searchParams.has("user_id") ? profile : [profile]);
      }
      if (url.pathname === "/rest/v1/rpc/get_my_app_access") {
        if (state.stall === "access") return;
        if (missingApp) return json({ code: "PGRST202", message: "Could not find the function public.get_my_app_access" }, 404);
        return json({ permissions: ["app.access"], roles: [], member: null });
      }
      if (url.pathname === "/rest/v1/site_settings") return json(null);
      if (url.pathname.startsWith("/rest/v1/")) return json([]);
      return json({});
    });
    const login = async () => {
      await page.getByLabel("E-mail", { exact: true }).fill(user.email);
      await page.getByLabel("Wachtwoord", { exact: true }).fill("fixture-password");
      await page.getByRole("button", { name: "Inloggen", exact: true }).click();
    };
    const home = () => page.getByRole("heading", { name: "Bienvenue, Test member", exact: true }).waitFor();
    await page.goto(base + "/fixture-app/?app=home");
    return { context, page, state, login, home };
  }

  {
    const f = await fixture();
    f.state.badPassword = true;
    await f.login();
    await f.page.getByText("Invalid login credentials", { exact: true }).waitFor();
    assert.equal(await f.page.getByRole("button", { name: "Inloggen", exact: true }).isEnabled(), true);
    f.state.badPassword = false;
    await f.login(); await f.home();
    assert.equal(await f.page.getByRole("button", { name: "Team & toegang", exact: true }).count(), 0);
    await f.page.reload(); await f.home();
    await f.page.getByRole("button", { name: "Se déconnecter", exact: true }).first().click();
    await f.page.getByRole("heading", { name: "Leiding login" }).waitFor();
    await f.page.reload(); await f.page.getByRole("heading", { name: "Leiding login" }).waitFor();
    await f.context.close();
    console.log("Auth: invalid password recovery, desktop APP login, session refresh and logout passed (real Supabase SDK).");
  }
  {
    const f = await fixture({ stall: "login" });
    await f.login();
    assert.equal(await f.page.getByRole("button", { name: "Aanmelden...", exact: true }).isDisabled(), true);
    await f.page.locator(".admin-notice-error").waitFor();
    assert.equal(await f.page.getByRole("button", { name: "Inloggen", exact: true }).isEnabled(), true);
    assert.equal(f.state.logins, 1, "A pending login must not trigger duplicate submissions.");
    f.state.stall = "";
    await f.login(); await f.home();
    await f.context.close();
    console.log("Auth: stalled login stops and a retry succeeds.");
  }
  {
    const f = await fixture({ stall: "profile" });
    await f.login();
    await f.page.getByRole("heading", { name: "De admin kon niet volledig laden" }).waitFor();
    f.state.stall = "";
    await f.page.getByRole("button", { name: "Opnieuw proberen", exact: true }).click();
    await f.home();
    await f.context.close();
    console.log("Auth: stalled profile read leaves loading and retries successfully.");
  }
  {
    const f = await fixture({ siteRole: "admin", missingApp: true });
    await f.login();
    await f.page.getByRole("alert").filter({ hasText: "L’espace APP n’est pas encore configuré" }).waitFor();
    await f.page.getByRole("button", { name: "Team & toegang", exact: true }).first().waitFor();
    await f.context.close();
    console.log("Auth: missing APP migration is visible while SITE remains available.");
  }
  {
    const f = await fixture({ blockedStorage: true });
    await f.login(); await f.home();
    await f.page.getByRole("button", { name: "Se déconnecter", exact: true }).first().click();
    await f.page.getByRole("heading", { name: "Leiding login" }).waitFor();
    await f.context.close();
    console.log("Auth: blocked browser storage still permits login and logout.");
  }
  {
    const f = await fixture();
    await f.page.evaluate(() => sessionStorage.setItem("sb-auth-auth-token-code-verifier", JSON.stringify("fixture-code-verifier")));
    await f.page.goto(base + "/fixture-app/auth-action/?type=recovery&code=one-time-code");
    await f.page.getByRole("heading", { name: "Stel je wachtwoord in" }).waitFor();
    assert.equal(f.state.exchanges, 1, "A recovery code must be exchanged exactly once.");
    await f.context.close();
    console.log("Auth: recovery code is exchanged once and opens password setup.");
  }
  assert.deepEqual(errors, []);
  console.log("Auth browser regression suite passed. All authentication traffic was intercepted locally.");
} finally {
  await browser?.close();
  await server?.close();
}
