import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { init, parse } from "es-module-lexer";

test("Astro keeps Netlify deploy IDs inside static and lazy import specifiers", async () => {
  const { pluginChunkImports } = await import("../node_modules/astro/dist/core/build/plugins/plugin-chunk-imports.js");
  await init;
  for (const deploy of ["6ab451ba1488fb00085b70ba", "local-deploy"]) {
    const options = { settings: { adapter: { client: { assetQueryParams: new URLSearchParams({ dpl: deploy }) } } } };
    const plugin = pluginChunkImports(options as unknown as Parameters<typeof pluginChunkImports>[0]);
    assert.ok(plugin?.generateBundle);
    const hook = typeof plugin.generateBundle === "function" ? plugin.generateBundle : plugin.generateBundle.handler;
    const source = `
      import './hooks.js';
      export { default } from './entry.js';
      const single = () => import('./agenda.js');
      const double = () => import("../tasks.mjs");
      const absolute = () => import('/external.js');
      const existing = () => import('./existing.js?keep=1');
      const computed = path => import(path);
    `;
    // This hook only reads code; the other Rollup context fields are unused.
    const chunk = { type: "chunk", code: source };
    await hook.call({} as never, {} as never, { "entry.js": chunk } as never, false);
    const { code } = chunk;
    const checked = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: code, encoding: "utf8", windowsHide: true });
    assert.equal(checked.status, 0, checked.stderr);
    const [imports] = parse(code);
    assert.deepEqual(imports.map(item => item.n), [
      `./hooks.js?dpl=${deploy}`, `./entry.js?dpl=${deploy}`,
      `./agenda.js?dpl=${deploy}`, `../tasks.mjs?dpl=${deploy}`,
      '/external.js', './existing.js?keep=1', undefined
    ]);
  }
});
