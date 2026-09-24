import { Temporal } from "@js-temporal/polyfill";
import { addDays, civil, endDay, MAX_DATE, onDate, overlaps, startDay, weekdays } from "./dates.ts";
import type { CalendarEvent, EventOccurrence, EventOverride, Recurrence } from "./types.ts";

// Emit only within the requested window. Monthly dates absent from a month are skipped.
export function occurrenceDates(event: CalendarEvent, through: string): string[] {
  const start = civil(startDay(event));
  const limit = [through, event.until_date ?? MAX_DATE, MAX_DATE].sort()[0];
  const result: string[] = [];
  if (event.frequency === "NONE") return start.toString() <= limit ? [start.toString()] : [];
  if (event.frequency === "WEEKLY") {
    const monday = start.subtract({ days: start.dayOfWeek - 1 });
    for (let week = monday; week.toString() <= limit; week = week.add({ weeks: event.recurrence_interval })) {
      for (const weekday of [...event.weekdays].sort((a, b) => a - b)) {
        const date = week.add({ days: weekday - 1 }).toString();
        if (date < start.toString() || date > limit) continue;
        result.push(date);
        if (event.occurrence_count && result.length >= event.occurrence_count) return result;
      }
    }
  } else {
    for (let month = start.with({ day: 1 }); month.toString() <= limit; month = month.add({ months: event.recurrence_interval })) {
      if (month.daysInMonth < start.day) continue;
      const date = month.with({ day: start.day }).toString();
      if (date > limit) break;
      result.push(date);
      if (event.occurrence_count && result.length >= event.occurrence_count) return result;
    }
  }
  return result;
}

export function expandEvents(events: CalendarEvent[], overrides: EventOverride[], from: string, to: string): EventOccurrence[] {
  const result: EventOccurrence[] = [];
  for (const event of events) {
    const exceptions = overrides.filter(item => item.event_id === event.id);
    const byDate = new Map(exceptions.map(item => [item.occurrence_date, item]));
    const durationDays = Temporal.PlainDate.from(startDay(event)).until(Temporal.PlainDate.from(endDay(event))).days;
    const earliest = addDays(from, -durationDays);
    for (const date of occurrenceDates(event, to)) {
      if (date < earliest || byDate.has(date)) continue;
      const occurrence: EventOccurrence = { ...event, ...onDate(event, date), event, occurrence_date: date, overridden: false };
      if (overlaps(occurrence, from, to)) result.push(occurrence);
    }
    // Include exceptions moved in from outside the window; suppress moved-out originals.
    for (const override of exceptions) {
      if (overlaps(override, from, to)) result.push({ ...override, event, overridden: true,
        status: event.status === "CANCELLED" ? "CANCELLED" : override.status });
    }
  }
  return result.sort((a, b) => startDay(a).localeCompare(startDay(b)) || Number(b.all_day) - Number(a.all_day)
    || (a.starts_at ?? "").localeCompare(b.starts_at ?? "") || a.title.localeCompare(b.title, "nl"));
}

export function recurrenceLabel(rule: Recurrence) {
  if (rule.frequency === "NONE") return "Zonder herhaling";
  const cadence = rule.frequency === "MONTHLY" ? `Om de ${rule.recurrence_interval} maanden (dezelfde dag van de maand)`
    : `Om de ${rule.recurrence_interval} week/weken · ${rule.weekdays.map(day => weekdays[day - 1]).join(", ")}`;
  return `${cadence}${rule.until_date ? ` · tot en met ${rule.until_date}` : ""}${rule.occurrence_count ? ` · ${rule.occurrence_count} keer` : ""}`;
}
