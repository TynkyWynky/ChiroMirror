import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOnline, networkError } from "../pwa/network.ts";
import { localizeCategories } from "../events/categories.ts";
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
  requireOnline();
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
  return { preferences: { ...defaultPreferences, ...preferences.data } as NotificationPreferences, categories: (categories.data ?? []) as CategoryPreference[], choices: localizeCategories((choices.data ?? []) as { key: string; label: string }[]), devices: (devices.data ?? []) as PushDevice[] };
}
export function notificationError(cause: unknown) {
  const network = networkError(cause); if(network)return network;
  if (cause instanceof Error) {
    if (cause.message === "PUSH_UNAVAILABLE") return "Notificaties zijn niet beschikbaar op dit apparaat.";
    if (cause.message === "PUSH_DENIED") return "Notificaties zijn geblokkeerd. Wijzig dit in de browser- of systeeminstellingen.";
    if (cause.message === "UNSUBSCRIBE_FAILED") return "Dit apparaat kon niet worden uitgeschakeld. Probeer opnieuw.";
  }
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    if (cause.code === "42501") return "Actie niet toegestaan. Schakel op een gedeeld apparaat het abonnement uit en activeer het daarna opnieuw met je eigen account.";
    if (cause.code === "22023") return "Controleer de instellingen. Wacht één minuut tussen twee testmeldingen.";
    if (cause.code === "40001") return "De bron is gewijzigd. Ververs en probeer opnieuw.";
  }
  // Do not echo arbitrary transport exceptions: they may contain endpoint/key material.
  return "Deze actie kon niet worden voltooid. Ververs en probeer opnieuw.";
}
