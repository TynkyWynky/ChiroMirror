import { Temporal } from "@js-temporal/polyfill";
import type { Reminder } from "./types.ts";
export const localReminder = (days = 1): Reminder => ({ kind: "LOCAL_TIME", days_before: days, local_time: "19:00", offset_minutes: null, scheduled_at: null });
export const offsetReminder = (minutes = 120): Reminder => ({ kind: "OFFSET", offset_minutes: minutes, days_before: null, local_time: null, scheduled_at: null });
export function defaultEventReminders(category: string): Reminder[] { return (category === "CAMP" ? [14,7,1] : category === "WEEKEND" ? [7,1] : category === "ACTIVITY" ? [1] : []).map(localReminder); }
export function validateReminders(rows: Reminder[], recurring = false) {
  if (rows.length > 10) throw new Error("Je kunt maximaal 10 herinneringen instellen.");
  const signatures = new Set<string>();
  for (const row of rows) {
    if (row.kind === "LOCAL_TIME") {
      if (!Number.isInteger(row.days_before) || row.days_before! < 0 || row.days_before! > 365 || !row.local_time || row.offset_minutes !== null || row.scheduled_at !== null) throw new Error("Controleer de dagen en het tijdstip van de herinnering.");
      Temporal.PlainTime.from(row.local_time);
    } else if (row.kind === "OFFSET") {
      if (!Number.isInteger(row.offset_minutes) || row.offset_minutes! < 0 || row.offset_minutes! > 525600 || row.days_before !== null || row.local_time !== null || row.scheduled_at !== null) throw new Error("Controleer de termijn van de herinnering.");
    } else if (row.kind === "ABSOLUTE") {
      if (recurring) throw new Error("Gebruik relatieve herinneringen voor een terugkerende reeks.");
      if (!row.scheduled_at || row.offset_minutes !== null || row.days_before !== null || row.local_time !== null) throw new Error("Kies een datum en tijd voor de herinnering.");
      Temporal.Instant.from(row.scheduled_at);
    } else throw new Error("Ongeldige herinnering.");
    const signature = JSON.stringify([row.kind,row.days_before,row.local_time ? Temporal.PlainTime.from(row.local_time).toString() : null,row.offset_minutes,row.scheduled_at]);
    if (signatures.has(signature)) throw new Error("Dezelfde herinnering is meerdere keren ingesteld.");
    signatures.add(signature);
  }
  return rows;
}
