import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { database, fixtureId as id } from "../tests/helpers/database.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const db = await database(true, true, true);
let server, browser;
try {
  for (const [n, first, role] of [[1, "Camille", "RESPONSIBLE"], [2, "Alex", "MEMBER"], [3, "Robin", "APP_ADMIN"]]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [id(n), `tasks${n}@example.test`]);
    await db.query("insert into public.app_user_roles(user_id,role_key) values($1,$2)", [id(n), role]);
    await db.query("insert into public.members(id,user_id,first_name,last_name) values($1,$2,$3,'Exemple')", [id(100+n), id(n), first]);
  }
  await db.query("insert into public.members(id,first_name,last_name,active) values($1,'Ancien','Membre',false)", [id(199)]);
  const tables = ["tasks", "task_members", "task_reminders", "task_activity", "members", "events", "event_occurrence_overrides"];
  server = await createServer({ configFile: false, root: `${root}/tests/fixtures/tasks`,
    esbuild: { jsx: "automatic", jsxImportSource: "preact" },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
    plugins: [{ name: "ephemeral-tasks-db", configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/fixture-api")) return next();
        res.setHeader("Content-Type", "application/json");
        try {
          const url = new URL(req.url, "http://127.0.0.1"), actor = Number(url.searchParams.get("actor"));
          assert.ok([1, 2, 3].includes(actor));
          const data = await db.transaction(async tx => {
            await tx.exec(`set local role authenticated; set local request.jwt.claim.sub='${id(actor)}'`);
            if (url.searchParams.has("access")) return (await tx.query("select public.get_my_app_access() data")).rows[0].data;
            if (req.method === "GET") {
              const table = url.searchParams.get("table"); assert.ok(tables.includes(table));
              const from = Number(url.searchParams.get("from")), limit = Number(url.searchParams.get("to")) - from + 1;
              const filter = table === "task_activity" ? "where task_id=$3" : "";
              const order = table === "task_activity" ? "created_at desc,id" : table === "task_members" ? "task_id,member_id" : table === "event_occurrence_overrides" ? "event_id,occurrence_date" : "id";
              return (await tx.query(`select coalesce(jsonb_agg(to_jsonb(t)), '[]') data from (select * from public.${table} ${filter} order by ${order} limit $1 offset $2) t`, [limit, from, ...(filter ? [url.searchParams.get("task")] : [])])).rows[0].data;
            }
            let body = ""; for await (const chunk of req) body += chunk;
            const { name, args } = JSON.parse(body);
            const calls = {
              save_task_with_reminders: ["select public.save_task_with_reminders($1,$2,$3,$4,$5)", [args.target_id,args.expected_revision,args.details,args.assignments,args.reminders]],
              save_task: ["select public.save_task($1,$2,$3,$4)", [args.target_id, args.expected_revision, args.details, args.assignments]],
              set_my_task_work_status: ["select public.set_my_task_work_status($1,$2,$3)", [args.target_id, args.expected_revision, args.new_status]]
            };
            assert.ok(Object.hasOwn(calls, name));
            const [sql, values] = calls[name]; await tx.query(sql, values); return null;
          });
          res.end(JSON.stringify({ data, error: null }));
        } catch (error) { res.end(JSON.stringify({ data: null, error: { code: error.code, message: error.message } })); }
      });
    } }]
  });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const executablePath = process.env.TASKS_BROWSER_PATH ?? process.env.AGENDA_BROWSER_PATH ?? ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(path => existsSync(path));
  if (!executablePath) throw new Error("Set TASKS_BROWSER_PATH to an installed Chromium/Edge executable.");
  browser = await chromium.launch({ executablePath, headless: true });
  console.log("Tasks browser: fixture ready");
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-09-23T10:00:00Z"));
  await page.goto(base);
  await page.getByRole("button", { name: "+ Tâche d’équipe", exact: true }).click();
  await page.getByLabel("Titre *", { exact: true }).fill("Préparer le souper");
  await page.getByLabel("Statut", { exact: true }).selectOption("IN_PROGRESS");
  await page.getByLabel("Priorité", { exact: true }).selectOption("HIGH");
  await page.getByLabel("Échéance", { exact: true }).selectOption("DATE");
  await page.getByLabel("Date limite *", { exact: true }).fill("2026-09-22");
  assert.equal(await page.getByLabel("Rôle de Ancien Membre").count(), 0);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Choisissez au moins un responsable" }).waitFor();
  await page.getByLabel("Rôle de Camille Exemple").selectOption("LEAD");
  await page.getByLabel("Rôle de Robin Exemple").selectOption("LEAD");
  await page.getByLabel("Rôle de Alex Exemple").selectOption("CONTRIBUTOR");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByText("Tâche enregistrée.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Préparer le souper", exact: true }).waitFor();
  await page.getByRole("button", { name: "Je supervise", exact: true }).click();
  await page.getByText("0 / 3 personnes terminées", { exact: true }).waitFor();
  console.log("Tasks browser: team created");
  const artifacts = `${root}/.test-artifacts`; mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: `${artifacts}/tasks-desktop.png`, fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.setDefaultTimeout(15000);
  mobile.on("pageerror", error => errors.push(error.message));
  await mobile.clock.setFixedTime(new Date("2026-09-23T10:00:00Z"));
  await mobile.goto(`${base}/?actor=2`);
  await mobile.getByRole("button", { name: "Préparer le souper", exact: true }).waitFor();
  assert.equal(await mobile.getByRole("button", { name: "+ Tâche d’équipe", exact: true }).count(), 0);
  assert.equal(await mobile.getByRole("button", { name: "Toutes", exact: true }).count(), 0);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.getByRole("button", { name: "✓ J’ai terminé", exact: true }).click();
  await mobile.getByText("1 / 3 personnes terminées", { exact: true }).waitFor();
  assert.equal((await db.query("select status from public.tasks where scope='TEAM'")).rows[0].status, "IN_PROGRESS");
  await mobile.getByRole("button", { name: "Remettre ma partie à faire", exact: true }).click();
  await mobile.getByText("0 / 3 personnes terminées", { exact: true }).waitFor();
  await mobile.getByRole("button", { name: "✓ J’ai terminé", exact: true }).click();
  await mobile.getByText("1 / 3 personnes terminées", { exact: true }).waitFor();
  await mobile.screenshot({ path: `${artifacts}/tasks-mobile.png`, fullPage: true });
  await mobile.getByRole("button", { name: "Préparer le souper", exact: true }).click();
  await mobile.getByRole("heading", { name: "Historique récent", exact: true }).waitFor();
  await mobile.locator(".task-audit").getByText("Partie terminée", { exact: true }).first().waitFor();
  assert.equal(await mobile.getByRole("button", { name: /^(Modifier|Terminer la tâche|Annuler la tâche)$/ }).count(), 0);
  await mobile.getByRole("button", { name: "Fermer la fiche", exact: true }).click();
  await mobile.getByRole("button", { name: "+ Tâche personnelle", exact: true }).click();
  assert.equal(await mobile.getByLabel(/Rôle de/).count(), 0);
  await mobile.getByLabel("Titre *", { exact: true }).fill("Mon pense-bête privé");
  await mobile.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await mobile.getByRole("button", { name: "Mon pense-bête privé", exact: true }).waitFor();

  // A stale lead view cannot overwrite the contributor's independent changes.
  await page.getByRole("button", { name: "Préparer le souper", exact: true }).click();
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  await page.getByLabel("Titre *", { exact: true }).fill("Titre périmé");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "modifiée ailleurs" }).waitFor();
  await page.getByRole("button", { name: "Fermer sans enregistrer", exact: true }).click();
  await page.getByRole("button", { name: "Actualiser les tâches", exact: true }).click();
  await page.getByText("1 / 3 personnes terminées", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Préparer le souper", exact: true }).click();
  let confirmation = "";
  page.once("dialog", async dialog => { confirmation = dialog.message(); await dialog.accept(); });
  await page.getByRole("button", { name: "Terminer la tâche", exact: true }).click();
  await page.getByText("Tâche terminée.", { exact: true }).waitFor();
  assert.match(confirmation, /2 personne/);
  assert.equal((await db.query("select status from public.tasks where scope='TEAM'")).rows[0].status, "DONE");

  const admin = await browser.newPage();
  admin.setDefaultTimeout(15000);
  admin.on("pageerror", error => errors.push(error.message));
  await admin.goto(`${base}/?actor=3`);
  await admin.getByRole("button", { name: "Toutes", exact: true }).click();
  await admin.getByLabel("Filtrer le statut", { exact: true }).selectOption("");
  await admin.getByRole("button", { name: "Préparer le souper", exact: true }).waitFor();
  assert.equal(await admin.getByRole("button", { name: "Mon pense-bête privé", exact: true }).count(), 0);
  const visible = await admin.evaluate(async () => (await (await fetch("/fixture-api?actor=3&table=tasks&from=0&to=99")).json()).data);
  assert.equal(visible.some(task => task.scope === "PERSONAL"), false, "admin privacy enforced by SQL, not only the view");
  await mobile.goto(`${base}/?actor=2&summary`);
  await mobile.getByText("Mon pense-bête privé", { exact: true }).waitFor();
  assert.equal(await mobile.getByText("Préparer le souper", { exact: true }).count(), 0);
  await mobile.getByRole("button", { name: "Voir mes tâches", exact: true }).click();
  await mobile.getByRole("button", { name: "Mon pense-bête privé", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("Tasks browser checks passed: desktop/mobile, validation, multiple leads, own work/reopen, private tasks, real admin RLS, audit, revision conflict, closure confirmation and dashboard. Screenshots: .test-artifacts/");
} finally { await browser?.close(); await server?.close(); await db.close(); }
