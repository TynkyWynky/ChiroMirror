export type ReminderKind = "LOCAL_TIME" | "OFFSET" | "ABSOLUTE";
export interface Reminder {
  id?: string; kind: ReminderKind; offset_minutes: number | null; days_before: number | null;
  local_time: string | null; scheduled_at: string | null; timezone?: string; event_id?: string; task_id?: string;
}
export interface NotificationPreferences { user_id?: string; push_enabled: boolean; event_notifications_enabled: boolean; task_notifications_enabled: boolean; push_details: boolean }
export const defaultPreferences: NotificationPreferences = { push_enabled: false, event_notifications_enabled: true, task_notifications_enabled: true, push_details: false };
export interface CategoryPreference { category_key: string; enabled: boolean }
export interface PushDevice { id: string; device_label: string; active: boolean; last_seen_at: string }
export interface AppNotification { id: string; kind: "EVENT_REMINDER" | "TASK_REMINDER" | "SYSTEM"; title: string; body: string; source_type: "EVENT" | "TASK" | "SYSTEM"; source_id: string; source_occurrence_key: string; created_at: string; read_at: string | null }
export interface NotificationTarget { type: "EVENT" | "TASK"; id: string; occurrence?: string }
