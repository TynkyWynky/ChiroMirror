export const EVENT_ZONE = "Europe/Brussels";
export type EventStatus = "SCHEDULED" | "CANCELLED";
export type Audience = "ALL" | "SELECTED";
export type Frequency = "NONE" | "WEEKLY" | "MONTHLY";
export interface EventCategory { key: string; label: string }
export interface EventTiming {
  all_day: boolean;
  start_date: string | null;
  end_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: typeof EVENT_ZONE;
}
export interface EventDetails extends EventTiming {
  title: string;
  description: string;
  location: string;
  category: string;
}
export interface Recurrence {
  frequency: Frequency;
  recurrence_interval: number;
  weekdays: number[];
  until_date: string | null;
  occurrence_count: number | null;
}
export interface CalendarEvent extends EventDetails, Recurrence {
  id: string;
  audience_type: Audience;
  status: EventStatus;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
}
export interface EventOverride extends EventDetails {
  event_id: string;
  occurrence_date: string;
  status: EventStatus;
  updated_by: string | null;
  updated_at: string;
}
export interface EventParticipant { event_id: string; member_id: string }
export interface EventOccurrence extends EventDetails {
  event: CalendarEvent;
  occurrence_date: string;
  status: EventStatus;
  overridden: boolean;
}
export interface EventInput extends EventDetails, Recurrence {
  reminders?: import("../notifications/types").Reminder[];
  audience_type: Audience;
  participant_ids: string[];
}
export interface EventDraft {
  title: string; description: string; category: string; location: string;
  all_day: boolean; start: string; end: string;
  audience_type: Audience; participant_ids: string[];
  frequency: Frequency; recurrence_interval: number; weekdays: number[];
  until_date: string; occurrence_count: string;
}
