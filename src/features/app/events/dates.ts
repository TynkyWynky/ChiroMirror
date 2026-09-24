import { Temporal } from "@js-temporal/polyfill";
import { EVENT_ZONE, type EventTiming } from "./types.ts";

export const MIN_DATE = "2000-01-01", MAX_DATE = "2100-12-31";
export const weekdays = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];
export function civil(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < MIN_DATE || value > MAX_DATE) throw new Error("Kies een datum tussen 2000 en 2100.");
  return Temporal.PlainDate.from(value, { overflow: "reject" });
}
export function today() { return Temporal.Now.plainDateISO(EVENT_ZONE).toString(); }
export function addDays(date: string, days: number) { return Temporal.PlainDate.from(date).add({ days }).toString(); }
export function monthStart(date: string) { return Temporal.PlainDate.from(date).with({ day: 1 }).toString(); }
export function shiftMonth(date: string, months: number) { return Temporal.PlainDate.from(monthStart(date)).add({ months }).toString(); }
export function localToInstant(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Ongeldige datum en tijd.");
  civil(value.slice(0, 10));
  try {
    return Temporal.PlainDateTime.from(value, { overflow: "reject" }).toZonedDateTime(EVENT_ZONE, { disambiguation: "reject" }).toInstant().toString();
  } catch { throw new Error("Ongeldige, niet-bestaande of dubbele tijd bij de uurwisseling in Brussel. Kies een andere tijd."); }
}
export function instantToLocal(value: string) {
  return Temporal.Instant.from(value).toZonedDateTimeISO(EVENT_ZONE).toPlainDateTime().toString({ smallestUnit: "minute" });
}
export function startDay(timing: EventTiming) { return timing.all_day ? timing.start_date! : instantToLocal(timing.starts_at!).slice(0, 10); }
export function endDay(timing: EventTiming) { return timing.all_day ? timing.end_date! : instantToLocal(timing.ends_at!).slice(0, 10); }
export function onDate(timing: EventTiming, date: string): EventTiming {
  const offset = civil(startDay(timing)).until(civil(date)).days;
  if (timing.all_day) return { ...timing, start_date: date, end_date: addDays(timing.end_date!, offset) };
  // Calendar-day arithmetic on local wall time, never + 7 * 24 hours.
  const move = (instant: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(EVENT_ZONE)
    .toPlainDateTime().add({ days: offset }).toZonedDateTime(EVENT_ZONE, { disambiguation: "later" }).toInstant().toString();
  const starts_at = move(timing.starts_at!);
  let ends_at = move(timing.ends_at!);
  // A spring gap can move 02:30 past an intended 03:00 end. Keep the original
  // elapsed duration in this exceptional case instead of producing a negative interval.
  if (Temporal.Instant.compare(ends_at, starts_at) < 0) {
    const duration = Temporal.Instant.from(timing.starts_at!).until(Temporal.Instant.from(timing.ends_at!));
    ends_at = Temporal.Instant.from(starts_at).add(duration).toString();
  }
  return { ...timing, starts_at, ends_at };
}
export function overlaps(timing: EventTiming, from: string, to: string) {
  // Display windows and all-day ends are inclusive civil dates.
  return startDay(timing) <= to && endDay(timing) >= from;
}
export function formatDay(date: string, full = true) {
  return Temporal.PlainDate.from(date).toLocaleString("nl-BE", full
    ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
    : { day: "numeric", month: "short" });
}
export function formatMonth(date: string) { return Temporal.PlainDate.from(date).toLocaleString("nl-BE", { month: "long", year: "numeric" }); }
export function formatTime(instant: string) {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(EVENT_ZONE).toLocaleString("nl-BE", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
export function formatTiming(timing: EventTiming) {
  const start = startDay(timing), end = endDay(timing);
  if (timing.all_day) return `${formatDay(start)}${end !== start ? ` → ${formatDay(end)}` : ""} · Hele dag`;
  return `${formatDay(start)} om ${formatTime(timing.starts_at!)} → ${start !== end ? `${formatDay(end)} om ` : ""}${formatTime(timing.ends_at!)} (Brussel)`;
}
export function monthDays(date: string) {
  const first = Temporal.PlainDate.from(monthStart(date));
  const monday = first.subtract({ days: first.dayOfWeek - 1 });
  return Array.from({ length: 42 }, (_, i) => monday.add({ days: i }).toString());
}
