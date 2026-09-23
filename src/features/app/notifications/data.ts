import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppNotification, CategoryPreference, NotificationPreferences, PushDevice } from "./types.ts";
import { defaultPreferences } from "./types.ts";
export async function notificationsPage(client: SupabaseClient, page: number) {
  const { data, error } = await client.from("notifications").select("id,kind,title,body,source_type,source_id,source_occurrence_key,created_at,read_at").order("created_at", { ascending: false }).order("id").range(page * 30, page * 30 + 29);
  if (error) throw error;
  return (data ?? []) as AppNotification[];
}
export async function unreadCount(client: SupabaseClient) {
  const { count, error } = await client.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}
export async function notificationRpc<T = unknown>(client: SupabaseClient, name: string, args: object = {}): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data as T;
}
export async function loadNotificationSettings(client: SupabaseClient) {
  const [preferences, categories, choices, devices] = await Promise.all([
    client.from("notification_preferences").select("push_enabled,event_notifications_enabled,task_notifications_enabled,push_details").maybeSingle(),
    client.from("notification_category_preferences").select("category_key,enabled"),
    client.from("event_categories").select("key,label").order("label"),
    client.from("push_subscriptions").select("id,device_label,active,last_seen_at").order("last_seen_at", { ascending: false }).limit(50)
  ]);
  for (const result of [preferences, categories, choices, devices]) if (result.error) throw result.error;
  return { preferences: { ...defaultPreferences, ...preferences.data } as NotificationPreferences, categories: (categories.data ?? []) as CategoryPreference[], choices: (choices.data ?? []) as { key: string; label: string }[], devices: (devices.data ?? []) as PushDevice[] };
}
export function notificationError(cause: unknown) {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    if (cause.code === "42501") return "Action non autorisée. Pour un appareil partagé, désactivez son abonnement puis réactivez-le avec votre compte.";
    if (cause.code === "22023") return "Vérifiez les réglages. Attendez une minute entre deux notifications de test.";
    if (cause.code === "40001") return "La source a changé. Actualisez puis recommencez.";
  }
  // Do not echo arbitrary transport exceptions: they may contain endpoint/key material.
  return "Impossible de terminer cette action. Actualisez puis réessayez.";
}
