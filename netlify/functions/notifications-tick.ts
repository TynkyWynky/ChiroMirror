import { createClient } from "@supabase/supabase-js";
import { runNotificationTick } from "../../src/server/notifications/dispatcher.ts";
import { createPushSender } from "../../src/server/notifications/web-push.ts";

export default async function notificationsTick() {
  const env = process.env;
  if (env.NOTIFICATIONS_ENABLED !== "true") return new Response(null, { status: 204 });
  if (!env.PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("notifications-tick", { code: "CONFIG_MISSING" }); return new Response(null, { status: 503 });
  }
  const db = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(4000) }) }
  });
  try {
    const stats = await runNotificationTick(db, createPushSender(env));
    console.info("notifications-tick", stats); // Aggregate counts only; no keys/endpoints/content.
    return new Response(null, { status: 204 });
  } catch { console.warn("notifications-tick", { code: "TICK_FAILED" }); return new Response(null, { status: 503 }); }
}
export const config = { schedule: "* * * * *" };
