import type { SupabaseClient } from "@supabase/supabase-js";
import { notificationRpc } from "./data.ts";
export function pushSupport() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  const installed = matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const supported = window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return { ios, installed, supported, permission: "Notification" in window ? Notification.permission : "default" as NotificationPermission };
}
function keyBytes(value: string) {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
const localKey = (userId: string) => `chiro.push.device.${userId}`;
function remember(userId: string, id: string | null) { try { if (id) localStorage.setItem(localKey(userId), id); else localStorage.removeItem(localKey(userId)); } catch { /* Storage is optional. */ } }
function remembered(userId: string) { try { return localStorage.getItem(localKey(userId)); } catch { return null; } }
export function appScope() { return `/${location.pathname.split("/").filter(Boolean)[0] ?? ""}/`.replace("//", "/"); }
async function registration() {
  const reg = await navigator.serviceWorker.register(`${appScope()}push-sw.js`, { scope: appScope(), updateViaCache: "none" });
  if (reg.active) return reg;
  return navigator.serviceWorker.ready;
}
export async function reconcilePush(client: SupabaseClient, userId: string): Promise<string | null> {
  if (!pushSupport().supported) return null;
  const reg = await navigator.serviceWorker.getRegistration(appScope());
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) {
    const old = remembered(userId);
    if (old) { await notificationRpc(client, "disable_push_subscription", { target_id: old }); remember(userId, null); }
    return null;
  }
  const id = await notificationRpc<string | null>(client, "touch_push_subscription", { endpoint_value: subscription.endpoint });
  remember(userId, id);
  return id;
}
// Call directly from a user's click handler; never from a mount effect.
export async function enablePush(client: SupabaseClient, userId: string, publicKey: string, label: string): Promise<string> {
  const support = pushSupport();
  if (!support.supported || support.ios && !support.installed || !publicKey) throw new Error("PUSH_UNAVAILABLE");
  if (Notification.permission === "denied") throw new Error("PUSH_DENIED");
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") throw new Error("PUSH_DENIED");
  const reg = await registration();
  let subscription = await reg.pushManager.getSubscription();
  if (subscription) {
    const own = await notificationRpc<string | null>(client, "touch_push_subscription", { endpoint_value: subscription.endpoint });
    if (!own) { if (!await subscription.unsubscribe()) throw new Error("UNSUBSCRIBE_FAILED"); subscription = null; }
  }
  subscription ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const serialized = subscription.toJSON();
  const id = await notificationRpc<string>(client, "register_push_subscription", { details: { endpoint: serialized.endpoint, p256dh: serialized.keys?.p256dh, auth: serialized.keys?.auth, device_label: label.trim() || "Cet appareil" } });
  remember(userId, id); return id;
}
export async function disableCurrentPush(client: SupabaseClient, userId: string) {
  const support = pushSupport(), reg = support.supported ? await navigator.serviceWorker.getRegistration(appScope()) : undefined;
  const subscription = await reg?.pushManager.getSubscription();
  let failed = false;
  const disableServer = async () => {
    try {
      const id = subscription ? await notificationRpc<string | null>(client, "touch_push_subscription", { endpoint_value: subscription.endpoint }) : remembered(userId);
      if (id) await notificationRpc(client, "disable_push_subscription", { target_id: id });
    } catch { failed = true; }
  };
  const disableBrowser = async () => {
    try { if (subscription && !await subscription.unsubscribe()) failed = true; } catch { failed = true; }
  };
  await Promise.all([disableServer(), disableBrowser()]);
  for (const notification of await reg?.getNotifications() ?? []) notification.close();
  if (failed) throw new Error("UNSUBSCRIBE_FAILED");
  remember(userId, null);
}
