import { createHash } from "node:crypto";
import type { Delivery } from "./dispatcher.ts";
export function validPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.port && value.length <= 2048
      && /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/.test(url.hostname);
  } catch { return false; }
}
export function createPushSender(env: Record<string, string | undefined>) {
  const publicKey = env.PUBLIC_VAPID_PUBLIC_KEY, privateKey = env.VAPID_PRIVATE_KEY, subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return async (delivery: Delivery) => {
    if (!validPushEndpoint(delivery.subscription.endpoint)) throw { statusCode: 400 };
    // Keep the optional Push provider out of the public SSR module graph. A
    // missing VAPID setup must disable Push, never break the public site.
    const { default: webpush } = await import("web-push");
    const deviceKey = createHash("sha256").update(delivery.subscription.endpoint).digest("hex");
    return webpush.sendNotification(delivery.subscription, JSON.stringify({ ...delivery.payload, deviceKey }), {
      vapidDetails: { subject, publicKey, privateKey }, TTL: 60, urgency: "normal", timeout: 3000,
      // Same logical delivery replaces a still-queued provider message on retry.
      topic: delivery.id.replaceAll("-", "").slice(0, 32)
    });
  };
}
