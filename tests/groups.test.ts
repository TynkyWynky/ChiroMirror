import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { prepareGroupRows, upsertGroupRows } from "../src/lib/groups.ts";
import type { Group } from "../src/types/content.ts";
import { fixtureId, legacyDatabase } from "./helpers/database.ts";

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: "temp-group-new", slug: "", name: "Volwassen Begeleiders", themeKey: "ribbels",
    ageRange: "", birthYears: "", schoolYears: "", description: "Onze VB's staan klaar voor de leiding.",
    imageUrl: "https://example.test/site-media/groups/vb.jpeg", imageAlt: "Foto van onze VB's",
    sortOrder: 7, leaders: [{ name: "Testbegeleider", phone: "012/34.56.78" }], ...overrides
  };
}

test("new adult supervisors get a slug while keeping their photo, contacts and optional age fields", () => {
  const input = group({ name: "  Volwassen Begeleiders  " });
  const original = structuredClone(input);
  const [row] = prepareGroupRows([input]);
  assert.deepEqual(row, {
    slug: "volwassen-begeleiders", name: "Volwassen Begeleiders", theme_key: "ribbels",
    age_range: "", birth_years: "", school_years: "", description: input.description,
    image_url: input.imageUrl, image_alt: input.imageAlt, sort_order: 7, leaders: input.leaders
  });
  assert.equal(Object.hasOwn(row, "id"), false);
  assert.deepEqual(input, original, "preparing the request does not alter the editor's draft");
});

test("existing groups keep their database identity and custom slug after a name change", () => {
  const existing = group({ id: fixtureId(1), slug: "vb", name: "Onze volwassen begeleiders" });
  assert.equal(prepareGroupRows([existing])[0].id, fixtureId(1));
  assert.equal(prepareGroupRows([existing])[0].slug, "vb");
  assert.equal(prepareGroupRows([group({ slug: "  VB & Café  " })])[0].slug, "vb-cafe");
  assert.equal(prepareGroupRows([group({ id: undefined })])[0].id, undefined);
});

test("empty names, unusable slugs and normalized duplicate slugs are rejected before saving", () => {
  assert.throws(() => prepareGroupRows([group({ name: "   " })]), /naam/i);
  assert.throws(() => prepareGroupRows([group({ name: "!!!" })]), /slug/i);
  assert.throws(() => prepareGroupRows([group({ slug: "!!!" })]), /slug/i);
  assert.throws(() => prepareGroupRows([
    group({ id: fixtureId(1), slug: "volwassen-begeleiders" }),
    group({ name: "Volwassen Begeleiders" })
  ]), /slug/i);
  assert.deepEqual(prepareGroupRows([]), []);
});

test("a mixed Supabase upsert requests database defaults for new IDs and returns saved rows", async () => {
  const rows = prepareGroupRows([
    group({ id: fixtureId(1), slug: "ribbels", name: "Ribbels", ageRange: "6–8", sortOrder: 1 }),
    group()
  ]);
  const savedRows = [rows[0], { ...rows[1], id: fixtureId(2) }];
  const requests: Request[] = [];
  const client = createClient("https://example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify(savedRows), { status: 201, headers: { "Content-Type": "application/json" } });
      }
    }
  });

  const result = await upsertGroupRows(client, rows);
  assert.equal(result.error, null);
  assert.deepEqual(result.data, savedRows);
  assert.equal(requests.length, 1);
  const request = requests[0];
  const url = new URL(request.url);
  assert.equal(request.method, "POST");
  assert.equal(url.pathname, "/rest/v1/groups");
  assert.equal(url.searchParams.get("select"), "*");
  assert.ok(url.searchParams.get("columns")?.includes('"id"'));
  assert.match(request.headers.get("Prefer") ?? "", /missing=default/);
  assert.match(request.headers.get("Prefer") ?? "", /resolution=merge-duplicates/);
  assert.match(request.headers.get("Prefer") ?? "", /return=representation/);
  const sent = await request.json();
  assert.equal(sent[0].id, fixtureId(1));
  assert.equal(Object.hasOwn(sent[1], "id"), false);
  assert.deepEqual(sent, rows);

  assert.deepEqual(await upsertGroupRows(client, []), { data: [], error: null });
  assert.equal(requests.length, 1, "removing the final group must not send an empty upsert");
});

test("the groups schema reproduces missing-ID-as-NULL failure and accepts DEFAULT alongside an update", async () => {
  const db = await legacyDatabase();
  try {
    await db.query("insert into public.groups(id, slug, name, theme_key) values ($1, 'ribbels', 'Ribbels', 'ribbels')", [fixtureId(1)]);
    await assert.rejects(
      db.query("insert into public.groups(id, slug, name, theme_key) values (null, 'volwassen-begeleiders', 'Volwassen Begeleiders', 'ribbels')"),
      /null value in column "id".*not-null constraint/i
    );
    const saved = await db.query<{ id: string; slug: string; name: string; age_range: string }>(`
      insert into public.groups(id, slug, name, theme_key) values
        ($1, 'ribbels', 'Ribbels bijgewerkt', 'ribbels'),
        (default, 'volwassen-begeleiders', 'Volwassen Begeleiders', 'ribbels')
      on conflict (id) do update set name = excluded.name
      returning id, slug, name, age_range
    `, [fixtureId(1)]);
    const existing = saved.rows.find(row => row.slug === "ribbels")!;
    const added = saved.rows.find(row => row.slug === "volwassen-begeleiders")!;
    assert.equal(existing.id, fixtureId(1));
    assert.equal(existing.name, "Ribbels bijgewerkt");
    assert.match(added.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
    assert.notEqual(added.id, existing.id);
    assert.equal(added.age_range, "");
    assert.equal((await db.query<{ count: number }>("select count(*)::int as count from public.groups")).rows[0].count, 2);
  } finally {
    await db.close();
  }
});
