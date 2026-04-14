import { copyFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const sourceClientPath = path.join(projectRoot, "src", "lib", "preact-client-patched.js");
const targetClientPath = path.join(
  projectRoot,
  "node_modules",
  "@astrojs",
  "preact",
  "dist",
  "client.js"
);
const targetClientDevPath = path.join(
  projectRoot,
  "node_modules",
  "@astrojs",
  "preact",
  "dist",
  "client-dev.js"
);

const devEntry = `import "preact/debug";
import clientFn from "./client.js";

export default clientFn;
`;

await copyFile(sourceClientPath, targetClientPath);
await writeFile(targetClientDevPath, devEntry, "utf8");

console.log("Patched @astrojs/preact client entrypoints.");
