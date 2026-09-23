import { Temporal } from "@js-temporal/polyfill";
import { formatDay, formatTime, instantToLocal } from "../events/dates.ts";
import type { Task } from "./types.ts";

export function deadlineDay(task: Pick<Task, "deadline_date" | "deadline_at">) {
  return task.deadline_date ?? (task.deadline_at ? instantToLocal(task.deadline_at).slice(0, 10) : null);
}
export function isOverdue(task: Task, now = Temporal.Now.instant().toString()) {
  if (task.status === "DONE" || task.status === "CANCELLED") return false;
  if (task.deadline_at) return Temporal.Instant.compare(task.deadline_at, now) < 0;
  // A civil deadline is inclusive: overdue only after the entire Brussels day has passed.
  return Boolean(task.deadline_date && task.deadline_date < Temporal.Instant.from(now).toZonedDateTimeISO("Europe/Brussels").toPlainDate().toString());
}
export function formatDeadline(task: Pick<Task, "deadline_date" | "deadline_at">) {
  if (task.deadline_date) return `${formatDay(task.deadline_date)} (fin de journée)`;
  if (task.deadline_at) return `${formatDay(deadlineDay(task)!)} à ${formatTime(task.deadline_at)} (Bruxelles)`;
  return "Sans échéance";
}
export function sortTasks(tasks: Task[], now = Temporal.Now.instant().toString()) {
  const priority = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
  const closed = (task: Task) => task.status === "DONE" || task.status === "CANCELLED";
  const due = (task: Task) => task.deadline_date
    ? Temporal.PlainDate.from(task.deadline_date).add({ days: 1 }).toZonedDateTime({ timeZone: "Europe/Brussels", plainTime: "00:00" }).epochMilliseconds - 1
    : task.deadline_at ? Temporal.Instant.from(task.deadline_at).epochMilliseconds : Number.MAX_SAFE_INTEGER;
  return [...tasks].sort((a, b) => Number(closed(a)) - Number(closed(b)) || Number(isOverdue(b, now)) - Number(isOverdue(a, now))
    || due(a) - due(b) || priority[a.priority] - priority[b.priority] || a.title.localeCompare(b.title, "fr") || a.id.localeCompare(b.id));
}
