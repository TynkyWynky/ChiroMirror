import assert from "node:assert/strict";
import { test } from "node:test";
import { localizeCategories } from "../src/features/app/events/categories.ts";
import { formatDay } from "../src/features/app/events/dates.ts";
import { appManifest, offlineHtml } from "../src/server/pwa.ts";

test("Dutch UI localizes legacy category labels without changing keys or custom content", () => {
  const original = [{ key: "MEETING", label: "Réunion" }, { key: "CAMP", label: "Camp" }, { key: "CUSTOM", label: "Eigen categorie" }];
  const localized = localizeCategories(original);
  assert.deepEqual(localized.map(row => row.label), ["Eigen categorie", "Kamp", "Vergadering"]);
  assert.equal(localized.find(row => row.key === "MEETING")?.label, "Vergadering");
  assert.equal(original[0].label, "Réunion");
});

test("Installed app, offline fallback and Belgian dates use Dutch", () => {
  const manifest = appManifest("/leiding-login/");
  assert.equal(manifest.lang, "nl-BE");
  assert.deepEqual(manifest.shortcuts.map(item => item.name), ["Agenda", "Taken", "Rekeningen"]);
  assert.match(offlineHtml, /<html lang="nl">/);
  assert.match(offlineHtml, /Geen internetverbinding/);
  assert.equal(formatDay("2026-10-04"), "zondag 4 oktober 2026");
});
