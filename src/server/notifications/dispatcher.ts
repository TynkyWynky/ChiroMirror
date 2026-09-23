import { planSource, type PlanSource } from "./planner.ts";
export interface WorkerDatabase { rpc(name: string, args?: object): PromiseLike<{ data: unknown; error: unknown }> }
export interface Delivery { id: string; token: string; subscription_id: string; subscription: { endpoint: string; keys: { p256dh: string; auth: string } }; payload: { notificationId: string; deliveryId: string; title: string; body: string } }
export function pushErrorCode(error: unknown) {
  const status = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 0;
  if ([400,401,403,404,410,429,500,502,503,504].includes(status)) return String(status);
  if (status >= 400 && status < 500 && status !== 408) return "PERMANENT";
  return "TEMPORARY";
}
export async function runNotificationTick(db: WorkerDatabase, send: ((delivery: Delivery) => Promise<unknown>) | null, now?: string, budgetMs = 22000) {
  const start = Date.now(), stats = { planned: 0, internal: 0, sent: 0, failed: 0 };
  async function rpc<T>(name: string, args: object = {}): Promise<T> { const result = await db.rpc(name, args); if (result.error) throw new Error("DATABASE_ERROR"); return result.data as T; }
  const sources = await rpc<PlanSource[]>("claim_notification_sources", { batch_size: 5 });
  for (const source of sources) {
    if (Date.now() - start > budgetMs - 8000) break; // Unused leases expire; next tick resumes.
    try {
      const planned = planSource(source, now);
      if (await rpc<boolean>("commit_notification_plan", { kind: source.source_type, source: source.source_id, expected_revision: source.revision, token: source.claim_token, planned })) stats.planned++;
    } catch {
      await rpc("fail_notification_plan", { kind: source.source_type, source: source.source_id, token: source.claim_token }); stats.failed++;
    }
  }
  if (Date.now() - start > budgetMs - 6000) return stats;
  stats.internal = await rpc<number>("materialize_notification_jobs", { batch_size: 30 });
  if (send && Date.now() - start < budgetMs - 5000) {
    const deliveries = await rpc<Delivery[]>("claim_notification_deliveries", { batch_size: 10 });
    // Independent devices: one failure never prevents attempting the others.
    for (let offset = 0; offset < deliveries.length; offset += 5) {
      if (Date.now() - start > budgetMs - 4000) break;
      await Promise.all(deliveries.slice(offset, offset + 5).map(async delivery => {
        let code = "CANCELLED";
        try {
          if (await rpc<boolean>("authorize_notification_delivery", { target_id: delivery.id, token: delivery.token })) {
            try { await send(delivery); code = "OK"; stats.sent++; } catch (error) { code = pushErrorCode(error); stats.failed++; }
          }
          await rpc("finish_notification_delivery", { target_id: delivery.id, token: delivery.token, result_code: code });
        } catch { stats.failed++; /* Lease retries keep the same delivery ID; never log transport payloads. */ }
      }));
    }
  }
  if (Date.now() - start < budgetMs - 2000) await rpc("cleanup_notifications");
  return stats;
}
