import { Temporal } from "@js-temporal/polyfill";
import { expandEvents } from "../../features/app/events/recurrence.ts";
import { MAX_DATE, formatDay, formatTime, instantToLocal, startDay } from "../../features/app/events/dates.ts";
import type { CalendarEvent, EventOverride } from "../../features/app/events/types.ts";
import type { Task } from "../../features/app/tasks/types.ts";
import type { Reminder } from "../../features/app/notifications/types.ts";

export interface PlanSource {
  source_type: "EVENT" | "TASK"; source_id: string; revision: number; claim_token: string;
  source: CalendarEvent | Task | null; reminders: (Reminder & { id: string })[]; overrides: EventOverride[];
  recipients: { user_id: string; disabled_categories: string[] }[];
}
export interface PlannedJob { user_id: string; occurrence_key: string; reminder_id: string; due_at: string; expires_at: string; title: string; body: string }
const zone = "Europe/Brussels";
function localInstant(day: string, time: string) {
  return Temporal.PlainDateTime.from(`${day}T${time}`).toZonedDateTime(zone, { disambiguation: "later" }).toInstant();
}
export function reminderInstant(reminder: Reminder, day: string, anchor: string): string {
  if (reminder.kind === "ABSOLUTE") return Temporal.Instant.from(reminder.scheduled_at!).toString();
  if (reminder.kind === "OFFSET") return Temporal.Instant.from(anchor).subtract({ minutes: reminder.offset_minutes! }).toString();
  const date = Temporal.PlainDate.from(day).subtract({ days: reminder.days_before! }).toString();
  return localInstant(date, reminder.local_time!).toString();
}
export function planSource(input: PlanSource, now = Temporal.Now.instant().toString()): PlannedJob[] {
  if (!input.source || !input.recipients.length || !input.reminders.length) return [];
  const current = Temporal.Instant.from(now), lower = current.subtract({ hours: 24 }), upper = current.add({ hours: 90 * 24 });
  const jobs: PlannedJob[] = [];
  function add(day: string, anchor: string, occurrence: string, title: string, body: string, category?: string) {
    const anchorGrace = Temporal.Instant.from(anchor).add({ minutes: 15 });
    if (Temporal.Instant.compare(anchorGrace, current) <= 0) return;
    for (const reminder of input.reminders) {
      if (input.source_type === "EVENT" && (input.source as CalendarEvent).frequency !== "NONE" && reminder.kind === "ABSOLUTE") continue;
      const due_at = reminderInstant(reminder, day, anchor), due = Temporal.Instant.from(due_at);
      if (Temporal.Instant.compare(due, lower) < 0 || Temporal.Instant.compare(due, upper) > 0 || Temporal.Instant.compare(due, anchor) > 0) continue;
      // A short grace also permits a zero-minute reminder to survive the next cron tick.
      const expires = Temporal.Instant.compare(due.add({ hours: 24 }), anchorGrace) < 0 ? due.add({ hours: 24 }) : anchorGrace;
      if (Temporal.Instant.compare(expires, current) <= 0) continue;
      for (const recipient of input.recipients) {
        if (category && recipient.disabled_categories.includes(category)) continue;
        jobs.push({ user_id: recipient.user_id, occurrence_key: occurrence, reminder_id: reminder.id, due_at, expires_at: expires.toString(), title: title.slice(0, 250), body: body.slice(0, 1000) });
        if (jobs.length > 20000) throw new Error("PLAN_LIMIT");
      }
    }
  }
  if (input.source_type === "TASK") {
    const task = input.source as Task;
    if (["DONE", "CANCELLED"].includes(task.status) || !task.deadline_at && !task.deadline_date) return [];
    const day = task.deadline_date ?? instantToLocal(task.deadline_at!).slice(0, 10);
    // Date-only deadlines include the complete day; timed offsets use its final millisecond.
    const anchor = task.deadline_at ?? localInstant(Temporal.PlainDate.from(day).add({ days: 1 }).toString(), "00:00").subtract({ milliseconds: 1 }).toString();
    add(day, anchor, "", task.title, `Échéance : ${formatDay(day)}${task.deadline_at ? ` à ${formatTime(task.deadline_at)} (Bruxelles)` : " (fin de journée)"}.`);
  } else {
    const event = input.source as CalendarEvent;
    if (event.status === "CANCELLED") return [];
    const start = current.toZonedDateTimeISO(zone).toPlainDate().toString();
    // 90-day due horizon plus the largest allowed relative reminder (365 days).
    // Bound both recurrence expansion and emitted jobs; moved-in overrides are included.
    const through = [current.toZonedDateTimeISO(zone).toPlainDate().add({ days: 456 }).toString(), MAX_DATE].sort()[0];
    for (const occurrence of expandEvents([event], input.overrides, start, through)) {
      if (occurrence.status === "CANCELLED") continue;
      const day = startDay(occurrence), anchor = occurrence.starts_at ?? localInstant(day, "00:00").toString();
      add(day, anchor, occurrence.occurrence_date, occurrence.title, `${formatDay(day)}${occurrence.starts_at ? ` à ${formatTime(occurrence.starts_at)} (Bruxelles)` : " · toute la journée"}${occurrence.location ? ` · ${occurrence.location}` : ""}.`, occurrence.category);
    }
  }
  return jobs;
}
