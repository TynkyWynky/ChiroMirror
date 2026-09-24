import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { loadEnv } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const env = loadEnv("development", root, "");
const slug = (env.ADMIN_PATH_SLUG ?? "leiding-login").trim().toLowerCase()
  .replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9-]+/g, "-")
  .replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "leiding-login";
console.log(`APP sur ce PC : http://127.0.0.1:4321/${slug}/?app=home`);
console.log("Gardez cette fenêtre ouverte. Ctrl+C arrête le serveur local.");
if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_ANON_KEY) {
  console.log("Connexion non configurée : renseignez les deux variables publiques Supabase dans .env.local.");
}
const astroPackage = JSON.parse(readFileSync(new URL("../node_modules/astro/package.json", import.meta.url), "utf8"));
const server = spawn(process.execPath, [fileURLToPath(new URL(`../node_modules/astro/${astroPackage.bin.astro}`, import.meta.url)),
  "dev", "--host", "127.0.0.1", "--port", "4321", "--open", `/${slug}/?app=home`],
  { cwd: root, stdio: "inherit", windowsHide: true });
server.on("error", error => { console.error(error.message); process.exitCode = 1; });
server.on("exit", code => { process.exitCode = code ?? 0; });
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
