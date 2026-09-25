import type { SupabaseClient } from "@supabase/supabase-js";
import { notificationRpc } from "./data.ts";
import { appleMobile, installedContext, appScope, registerAppWorker } from "../pwa/environment.ts";
import { setPushDevice, bounded } from "../pwa/device.ts";
export { appScope } from "../pwa/environment.ts";
export type PushCapabilities = {
  secureContext: boolean;
  notificationApi: boolean;
  serviceWorkerApi: boolean;
  pushManagerApi: boolean;
  serviceWorkerRegistered: boolean;
  serviceWorkerActive: boolean;
  vapidPublicKeyConfigured: boolean;
  ios: boolean;
  installed: boolean;
  supported: boolean;
  permission: NotificationPermission;
};
export type PushState = "CHECKING" | "DEVICE_UNSUPPORTED" | "PUSH_NOT_CONFIGURED" | "PERMISSION_DEFAULT" | "PERMISSION_DENIED" | "READY_TO_SUBSCRIBE" | "SUBSCRIBED" | "SERVICE_WORKER_ERROR" | "SUBSCRIPTION_ERROR";

export function pushState(capabilities: PushCapabilities | null, subscribed = false): PushState {
  if (!capabilities) return "CHECKING";
  if (!capabilities.supported) return "DEVICE_UNSUPPORTED";
  if (!capabilities.vapidPublicKeyConfigured) return "PUSH_NOT_CONFIGURED";
  if (capabilities.permission === "denied") return "PERMISSION_DENIED";
  if (!capabilities.serviceWorkerRegistered || !capabilities.serviceWorkerActive) return "SERVICE_WORKER_ERROR";
  if (subscribed) return "SUBSCRIBED";
  return capabilities.permission === "default" ? "PERMISSION_DEFAULT" : "READY_TO_SUBSCRIBE";
}

export function pushSupport(publicKey = ""): PushCapabilities {
  const hasWindow = typeof window !== "undefined";
  const hasNavigator = typeof navigator !== "undefined";
  const secureContext = hasWindow && window.isSecureContext === true;
  const notificationApi = hasWindow && "Notification" in window;
  const serviceWorkerApi = hasNavigator && "serviceWorker" in navigator;
  const pushManagerApi = hasWindow && "PushManager" in window;
  return {
    secureContext,
    notificationApi,
    serviceWorkerApi,
    pushManagerApi,
    serviceWorkerRegistered: false,
    serviceWorkerActive: false,
    vapidPublicKeyConfigured: Boolean(publicKey.trim()),
    ios: appleMobile(),
    installed: installedContext(),
    supported: secureContext && notificationApi && serviceWorkerApi && pushManagerApi,
    permission: notificationApi ? Notification.permission : "default"
  };
}

/**
 * Reads browser capabilities without treating missing server configuration or
 * a service worker that is still activating as a browser incompatibility.
 */
export async function inspectPushCapabilities(publicKey = ""): Promise<PushCapabilities> {
  const capabilities = pushSupport(publicKey);
  if (!capabilities.supported) return capabilities;
  try {
    const existing = await navigator.serviceWorker.getRegistration(appScope());
    const registration = existing ?? await registerAppWorker();
    capabilities.serviceWorkerRegistered = Boolean(registration);
    capabilities.serviceWorkerActive = Boolean(registration.active || navigator.serviceWorker.controller);
    if (!capabilities.serviceWorkerActive) {
      const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<ServiceWorkerRegistration | null>(resolve => window.setTimeout(() => resolve(null), 2000))
      ]);
      capabilities.serviceWorkerActive = Boolean(ready?.active || navigator.serviceWorker.controller);
    }
  } catch {
    // The API is supported even when registration is temporarily unavailable.
    // The caller can display the registration state and allow a retry.
  }
  return capabilities;
}
function keyBytes(value: string) {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
const localKey = (userId: string) => `chiro.push.device.${userId}`;
function remember(userId: string, id: string | null) { try { if (id) localStorage.setItem(localKey(userId), id); else localStorage.removeItem(localKey(userId)); } catch { /* Storage is optional. */ } }
function remembered(userId: string) { try { return localStorage.getItem(localKey(userId)); } catch { return null; } }
async function registration() {
  const existing = await navigator.serviceWorker.getRegistration(appScope());
  const reg = existing ?? await registerAppWorker();
  if (reg.active) return reg;
  try { return await navigator.serviceWorker.ready; } catch { return reg; }
}
export async function reconcilePush(client: SupabaseClient, userId: string): Promise<string | null> {
  if (!pushSupport().supported) return null;
  let reg: ServiceWorkerRegistration | undefined;
  try { reg = await registration(); } catch { return null; }
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) {
    const old = remembered(userId);
    if (old) { await notificationRpc(client, "disable_push_subscription", { target_id: old }); remember(userId, null); }
    return null;
  }
  const id = await notificationRpc<string | null>(client, "touch_push_subscription", { endpoint_value: subscription.endpoint });
  if (id) await setPushDevice(false,subscription.endpoint);
  else { await setPushDevice(true); if (!await subscription.unsubscribe()) throw new Error("UNSUBSCRIBE_FAILED"); }
  remember(userId, id);
  return id;
}
// Call directly from a user's click handler; never from a mount effect.
export async function enablePush(client: SupabaseClient, userId: string, publicKey: string, label: string): Promise<string> {
  const support = pushSupport(publicKey);
  if (!support.supported || support.ios && !support.installed || !publicKey.trim()) throw new Error("PUSH_UNAVAILABLE");
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
  const id = await notificationRpc<string>(client, "register_push_subscription", { details: { endpoint: serialized.endpoint, p256dh: serialized.keys?.p256dh, auth: serialized.keys?.auth, device_label: label.trim() || "Dit apparaat" } });
  await setPushDevice(false,subscription.endpoint);
  remember(userId, id); return id;
}
export async function disableCurrentPush(client: SupabaseClient, userId: string) {
  let failed = false;
  try { await bounded(setPushDevice(true)); } catch { failed = true; }
  const support = pushSupport(), reg = support.supported ? await registration().catch(() => undefined) : undefined;
  const subscription = await reg?.pushManager.getSubscription();
  const disableServer = async () => {
    try {
      const id = remembered(userId) ?? (subscription ? await bounded(notificationRpc<string | null>(client, "touch_push_subscription", { endpoint_value: subscription.endpoint })) : null);
      if (id) await bounded(notificationRpc(client, "disable_push_subscription", { target_id: id }));
    } catch { failed = true; }
  };
  const disableBrowser = async () => {
    try { if (subscription && !await bounded(subscription.unsubscribe())) failed = true; } catch { failed = true; }
  };
  await disableServer(); await disableBrowser();
  for (const notification of await reg?.getNotifications() ?? []) notification.close();
  if (failed) throw new Error("UNSUBSCRIBE_FAILED");
  remember(userId, null);
}
