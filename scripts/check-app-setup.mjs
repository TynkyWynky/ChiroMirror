import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const env = loadEnv("development", root, "PUBLIC_");
const supabaseUrl = env.PUBLIC_SUPABASE_URL?.trim();
const publicKey = env.PUBLIC_SUPABASE_ANON_KEY?.trim();

if (!supabaseUrl || !publicKey) {
  console.error("Configuration locale manquante : PUBLIC_SUPABASE_URL et PUBLIC_SUPABASE_ANON_KEY sont nécessaires.");
  console.error("Copiez .env.example vers .env.local, puis renseignez l’URL Supabase et sa clé publique (anon/publishable). Relancez npm run doctor:app.");
  process.exitCode = 2;
} else {
  await checkSetup();
}

async function checkSetup() {
  let base;
  try {
    base = new URL(supabaseUrl);
    if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("INVALID_URL");
  } catch {
    console.error("PUBLIC_SUPABASE_URL est invalide. Utilisez l’URL HTTP(S) du projet Supabase, sans identifiants ni paramètres.");
    process.exitCode = 2;
    return;
  }

  const headers = { apikey: publicKey };
  // Publishable keys are API keys, not JWTs. Legacy anon JWTs can also authenticate REST.
  if (publicKey.startsWith("eyJ")) headers.Authorization = `Bearer ${publicKey}`;
  const endpoint = base.href.replace(/\/$/, "");
  console.log(`Diagnostic APP en lecture seule : ${base.host}`);

  async function probe(path) {
    try {
      const response = await fetch(endpoint + path, { method: "GET", headers, signal: AbortSignal.timeout(10_000), redirect: "error" });
      if (response.ok) {
        await response.body?.cancel();
        return { status: response.status, code: "" };
      }
      const body = await response.json().catch(() => null);
      const code = typeof body?.code === "string" && /^[A-Z0-9_]{1,20}$/.test(body.code) ? body.code : "";
      return { status: response.status, code };
    } catch (error) {
      // Transport errors and response bodies may contain key material: never print them.
      return { status: 0, code: error?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK" };
    }
  }

  const health = await probe("/auth/v1/health");
  let failed = health.status < 200 || health.status >= 300;
  let missing = false;
  if (!failed) console.log("OK — Service de connexion Supabase disponible.");
  else if (health.status === 401 || health.status === 403) console.error("ERREUR — La clé publique est refusée par Supabase. Vérifiez sa correspondance avec le projet.");
  else console.error(`ERREUR — Service de connexion indisponible (${health.status ? `HTTP ${health.status}` : health.code === "TIMEOUT" ? "délai dépassé" : "connexion impossible"}).`);

  const checks = [
    ["Membres", "/rest/v1/members?select=id&limit=0"],
    ["Agenda", "/rest/v1/events?select=id&limit=0"],
    ["Tâches", "/rest/v1/tasks?select=id&limit=0"],
    ["Notifications", "/rest/v1/notifications?select=id&limit=0"],
    ["Accès APP (get_my_app_access)", "/rest/v1/rpc/get_my_app_access"]
  ];
  const results = await Promise.all(checks.map(async ([label, path]) => ({ label, ...await probe(path) })));
  for (const result of results) {
    if (["PGRST202", "PGRST205", "42P01", "42883"].includes(result.code)) {
      failed = missing = true;
      console.error(`MANQUANT — ${result.label} : schéma APP absent ou non chargé (${result.code}).`);
    } else if (result.status >= 200 && result.status < 300) {
      console.log(`OK — ${result.label} disponible.`);
    } else if (result.status === 401 || result.status === 403) {
      console.log(`PROTÉGÉ — ${result.label} : authentification requise (HTTP ${result.status}, attendu sans session).`);
    } else {
      failed = true;
      console.error(`ERREUR — ${result.label} : ${result.status ? `HTTP ${result.status}` : result.code === "TIMEOUT" ? "délai dépassé" : "connexion impossible"}.`);
    }
  }

  if (missing) {
    console.error("Installation APP incomplète : appliquez les migrations manquantes de supabase/migrations dans leur ordre chronologique, puis relancez ce diagnostic.");
    console.error("Sur une base existante, utilisez les migrations ; ne réexécutez pas supabase/schema.sql. Procédure : docs/app-members.md.");
  }
  if (!failed) console.log("Points d’accès APP détectés. La connexion avec un compte et ses rôles APP restent à vérifier dans le navigateur.");
  console.log("Aucune donnée métier consultée ou modifiée ; aucun rôle attribué. Ce contrôle ne valide pas les droits d’un compte connecté ni l’envoi Push.");
  process.exitCode = failed ? 1 : 0;
}
