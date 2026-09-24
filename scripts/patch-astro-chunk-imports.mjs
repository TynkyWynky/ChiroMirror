import { readFile, writeFile } from "node:fs/promises";

// Astro 6.1.6 includes the closing quote in es-module-lexer's dynamic-import
// range, but not in static-import ranges. Insert Netlify's dpl before it.
// Keep this narrow patch guarded so an Astro upgrade requires a review.
const root = new URL("../node_modules/astro/", import.meta.url);
const { version } = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
if (version !== "6.1.6") throw new Error(`Review the chunk-import compatibility patch for Astro ${version}.`);
const target = new URL("dist/core/build/plugins/plugin-chunk-imports.js", root);
const source = await readFile(target, "utf8");
const original = 'rewritten = rewritten.slice(0, imp.e) + "?" + queryString + rewritten.slice(imp.e);';
const fixed = 'const end = imp.d >= 0 ? imp.e - 1 : imp.e;\n        rewritten = rewritten.slice(0, end) + "?" + queryString + rewritten.slice(end);';
if (source.includes(fixed)) {
  console.log("Astro chunk-import compatibility patch already applied.");
} else {
  if (source.split(original).length !== 2) throw new Error("Unexpected Astro chunk-import source; refusing an unsafe patch.");
  await writeFile(target, source.replace(original, fixed));
  console.log("Patched Astro dynamic-import deploy query placement.");
}
