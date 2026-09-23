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
  await db.exec(`insert into auth.users(id,email) values ('${id(1)}','responsible@example.test'),('${id(2)}','member@example.test');
    insert into public.app_user_roles(user_id,role_key) values ('${id(1)}','RESPONSIBLE'),('${id(2)}','MEMBER');
    insert into public.members(id,first_name,last_name,active) values ('${id(11)}','Camille','Exemple',true),('${id(12)}','Alex','Archivé',false);`);
  const base = { title: "Activité du dimanche", description: "Jeux en groupe", category: "ACTIVITY", location: "Locaux Chiro", all_day: false,
    start_date: null, end_date: null, starts_at: "2026-09-27T12:00:00Z", ends_at: "2026-09-27T16:00:00Z", timezone: "Europe/Brussels",
    audience_type: "ALL", frequency: "WEEKLY", recurrence_interval: 1, weekdays: [7], until_date: "2026-12-31", occurrence_count: null };
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${id(1)}'`);
  for (const details of [base,
    { ...base, title: "Réunion leiding", category: "MEETING", frequency: "NONE", weekdays: [], until_date: null, starts_at: "2026-09-23T18:00:00Z", ends_at: "2026-09-23T20:00:00Z" },
    { ...base, title: "Weekend Tito", category: "WEEKEND", frequency: "NONE", weekdays: [], until_date: null, starts_at: "2026-09-25T16:00:00Z", ends_at: "2026-09-27T12:00:00Z" },
    { ...base, title: "Camp de démonstration", category: "CAMP", frequency: "NONE", weekdays: [], until_date: null, all_day: true, start_date: "2026-09-16", end_date: "2026-09-30", starts_at: null, ends_at: null }
  ]) await db.query("select public.save_agenda_event(null,null,$1,'{}')", [details]);
  await db.exec("reset role; reset request.jwt.claim.sub");
  const allowedTables = ["events", "event_reminders", "event_categories", "event_occurrence_overrides", "event_participants", "members"];
  server = await createServer({ configFile: false, root: `${root}/tests/fixtures/agenda`,
    esbuild: { jsx: "automatic", jsxImportSource: "preact" },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
    plugins: [{ name: "ephemeral-agenda-db", configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/fixture-api")) return next();
        res.setHeader("Content-Type", "application/json");
        try {
          const url = new URL(req.url, "http://127.0.0.1");
          const data = await db.transaction(async tx => {
            await tx.exec(`set local role authenticated; set local request.jwt.claim.sub='${id(url.searchParams.get("reader") === "true" ? 2 : 1)}'`);
            if (req.method === "GET") {
              const table = url.searchParams.get("table");
              assert.ok(allowedTables.includes(table));
              const from = Number(url.searchParams.get("from"));
              const limit = Number(url.searchParams.get("to")) - from + 1;
              return (await tx.query(`select coalesce(jsonb_agg(to_jsonb(t)), '[]') data from (select * from public.${table} order by 1 limit $1 offset $2) t`, [limit, from])).rows[0].data;
            }
            let body = ""; for await (const chunk of req) body += chunk;
            const { name, args } = JSON.parse(body);
            const calls = {
              save_agenda_event_with_reminders: ["select public.save_agenda_event_with_reminders($1,$2,$3,$4,$5)", [args.target_id,args.expected_revision,args.details,args.participant_ids,args.reminders]],
              save_agenda_event: ["select public.save_agenda_event($1,$2,$3,$4)", [args.target_id, args.expected_revision, args.details, args.participant_ids]],
              save_agenda_occurrence: ["select public.save_agenda_occurrence($1,$2,$3,$4)", [args.target_id, args.original_date, args.expected_revision, args.details]],
              cancel_agenda_event: ["select public.cancel_agenda_event($1,$2,$3)", [args.target_id, args.original_date, args.expected_revision]]
            };
            assert.ok(Object.hasOwn(calls, name));
            const [sql, params] = calls[name]; await tx.query(sql, params); return null;
          });
          res.end(JSON.stringify({ data, error: null }));
        } catch (error) { res.end(JSON.stringify({ data: null, error: { code: error.code, message: error.message } })); }
      });
    } }]
  });
  await server.listen();
  const port = server.httpServer.address().port;
  const executablePath = process.env.AGENDA_BROWSER_PATH ?? [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"
  ].find(path => existsSync(path));
  if (!executablePath) throw new Error("Set AGENDA_BROWSER_PATH to an installed Chromium/Edge executable.");
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const pageErrors = []; page.on("pageerror", error => pageErrors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-09-23T10:00:00Z"));
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByRole("button", { name: "Mois", exact: true }).waitFor();
  await page.getByRole("button", { name: /Activité Activité du dimanche/ }).first().waitFor();
  const screenshots = `${root}/.test-artifacts`;
  mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/agenda-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "+ Nouvel événement", exact: true }).click();
  await page.getByLabel("Titre *", { exact: true }).fill("Événement navigateur");
  await page.getByLabel("Toute la journée", { exact: true }).check();
  await page.getByLabel("Début *", { exact: true }).fill("2026-09-24");
  await page.getByLabel("Fin *", { exact: true }).fill("2026-09-26");
  await page.getByLabel("Personnes concernées", { exact: true }).selectOption("SELECTED");
  assert.equal(await page.getByLabel("Alex Archivé").count(), 0);
  await page.getByLabel("Camille Exemple").check();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByText("Événement enregistré.", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Activité Événement navigateur/ }).first().click();
  await page.getByRole("heading", { name: "Événement navigateur", exact: true }).waitFor();
  assert.match(await page.locator(".agenda-detail").innerText(), /Camille Exemple/);
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await page.getByRole("button", { name: /Activité Activité du dimanche/ }).first().click();
  await page.getByRole("button", { name: "Modifier cette occurrence" }).click();
  await page.getByLabel("Titre *", { exact: true }).fill("Occurrence déplacée");
  await page.getByLabel("Début *", { exact: true }).fill("2026-09-28T15:00");
  await page.getByLabel("Fin *", { exact: true }).fill("2026-09-28T17:00");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByText("Événement enregistré.", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Activité Occurrence déplacée/ }).first().click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Annuler cette occurrence", exact: true }).click();
  await page.getByText("Annulation enregistrée.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Occurrence déplacée/ }).count(), 0);
  await page.getByLabel("Afficher les événements annulés").check();
  await page.getByRole("button", { name: /Annulé Occurrence déplacée/ }).first().waitFor();
  await page.getByRole("button", { name: /Activité Activité du dimanche/ }).first().click();
  await page.getByLabel("Portée de l’action", { exact: true }).selectOption("series");
  await page.getByRole("button", { name: "Modifier toute la série", exact: true }).click();
  await page.getByLabel("Titre *", { exact: true }).fill("Série navigateur");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByText("Événement enregistré.", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Activité Série navigateur/ }).first().waitFor();
  await page.getByRole("button", { name: /Annulé Occurrence déplacée/ }).first().waitFor();
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.on("pageerror", error => pageErrors.push(error.message));
  await mobile.clock.setFixedTime(new Date("2026-09-23T10:00:00Z"));
  await mobile.goto(`http://127.0.0.1:${port}/?reader`);
  await mobile.getByRole("button", { name: /Camp Camp de démonstration/ }).waitFor();
  assert.equal(await mobile.getByRole("button", { name: "Liste", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await mobile.getByRole("button", { name: /Nouvel événement/ }).count(), 0);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "mobile list must not overflow");
  await mobile.screenshot({ path: `${screenshots}/agenda-mobile.png`, fullPage: true });
  await mobile.getByRole("button", { name: /Camp Camp de démonstration/ }).click();
  assert.equal(await mobile.getByRole("button", { name: /Modifier|Annuler/ }).count(), 0);
  assert.deepEqual(pageErrors, []);
  await mobile.goto(`http://127.0.0.1:${port}/?reader&summary`);
  await mobile.getByRole("heading", { name: "Prochains événements", exact: true }).waitFor();
  await mobile.locator("main li").first().waitFor();
  assert.ok(await mobile.locator("main li").count() <= 3);
  await mobile.getByRole("button", { name: "Ouvrir l’agenda", exact: true }).click();
  await mobile.getByRole("button", { name: "Liste", exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
  console.log("Agenda browser checks passed: desktop month, mobile list, create, participants, occurrence move/cancel, reader permissions. Screenshots: .test-artifacts/");
} finally {
  await browser?.close(); await server?.close(); await db.close();
}
