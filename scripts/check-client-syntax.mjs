import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../dist/_astro/", import.meta.url));
const files = readdirSync(root, { recursive: true }).filter(file => /\.[cm]?js$/.test(String(file)));
if (files.length === 0) throw new Error("No generated client JavaScript found.");
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", join(root, String(file))], { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Invalid generated JavaScript: ${file}\n${result.stderr}`);
}
console.log(`Client syntax passed: ${files.length} generated JavaScript files.`);
