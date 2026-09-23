import assert from "node:assert/strict";
import { test } from "node:test";
import { planSource, reminderInstant, type PlanSource } from "../src/server/notifications/planner.ts";
import { pushErrorCode } from "../src/server/notifications/dispatcher.ts";
import { validateReminders } from "../src/features/app/notifications/reminders.ts";
import type { CalendarEvent, EventOverride } from "../src/features/app/events/types.ts";
import type { Task } from "../src/features/app/tasks/types.ts";
import { instantToLocal } from "../src/features/app/events/dates.ts";
const local = { id: "reminder", kind: "LOCAL_TIME" as const, days_before: 1, local_time: "19:00", offset_minutes: null, scheduled_at: null };
const event: CalendarEvent = { id: "event", title: "Activité", description: "", location: "Locaux", category: "ACTIVITY", timezone: "Europe/Brussels", all_day: false, start_date: null, end_date: null, starts_at: "2026-10-04T12:00:00Z", ends_at: "2026-10-04T16:00:00Z", audience_type: "ALL", status: "SCHEDULED", created_by: null, updated_by: null, created_at: "", updated_at: "", revision: 1, frequency: "NONE", recurrence_interval: 1, weekdays: [], until_date: null, occurrence_count: null };
const source = (patch: Partial<PlanSource> = {}): PlanSource => ({ source_type: "EVENT", source_id: "event", revision: 1, claim_token: "token", source: event, reminders: [local], overrides: [], recipients: [{ user_id: "person", disabled_categories: [] }], ...patch });
test("Notifications: October example and local 19:00 across both DST changes", () => {
  assert.equal(planSource(source(), "2026-09-23T10:00:00Z")[0].due_at, "2026-10-03T17:00:00Z");
  for (const [day, expected] of [["2026-03-29","2026-03-28T18:00:00Z"],["2026-03-30","2026-03-29T17:00:00Z"],["2026-10-25","2026-10-24T17:00:00Z"],["2026-10-26","2026-10-25T18:00:00Z"]]) {
    const due = reminderInstant(local, day, `${day}T12:00:00Z`); assert.equal(due, expected); assert.ok(instantToLocal(due).endsWith("T19:00"));
  }
});
test("Notifications: bounded recurring window, stable identities, moved/cancelled overrides and category opt-out", () => {
  const recurring = { ...event, frequency: "WEEKLY" as const, weekdays: [7] };
  const input = source({ source: recurring });
  const now = "2026-09-23T10:00:00Z", jobs = planSource(input, now);
  assert.ok(jobs.length > 10 && jobs.length < 14); assert.equal(new Set(jobs.map(j => j.occurrence_key)).size, jobs.length);
  assert.deepEqual(planSource(input, now), jobs);
  assert.ok(jobs.every(j => Date.parse(j.due_at) <= Date.parse(now) + 90*86400000));
  const override: EventOverride = { ...event, event_id: event.id, occurrence_date: "2026-10-04", starts_at: "2026-10-05T16:00:00Z", ends_at: "2026-10-05T18:00:00Z", updated_by: null, updated_at: "" };
  assert.equal(planSource({ ...input, overrides: [override] }, now).find(j => j.occurrence_key === "2026-10-04")?.due_at, "2026-10-04T17:00:00Z");
  assert.ok(!planSource({ ...input, overrides: [{ ...override, status: "CANCELLED" }] }, now).some(j => j.occurrence_key === "2026-10-04"));
  assert.deepEqual(planSource(source({ source: { ...recurring, status: "CANCELLED" } }), now), []);
  assert.deepEqual(planSource(source({ recipients: [{ user_id: "person", disabled_categories: ["ACTIVITY"] }] }), now), []);
  assert.equal(planSource(source({ overrides: [{ ...override, category: "CAMP" }], recipients: [{ user_id: "person", disabled_categories: ["ACTIVITY"] }] }), now).length, 1);
});
test("Notifications: task two-hour offset, date-only, terminal states, no deadline and invalid definitions", () => {
  const task = { id: "task", title: "Commander", status: "TODO", deadline_at: "2026-10-10T16:00:00Z", deadline_date: null } as Task;
  const input = source({ source_type: "TASK", source: task, reminders: [{ ...local, kind: "OFFSET", days_before: null, local_time: null, offset_minutes: 120 }] });
  const now = "2026-09-23T10:00:00Z";
  assert.equal(instantToLocal(planSource(input, now)[0].due_at), "2026-10-10T16:00");
  assert.equal(planSource({ ...input, source: { ...task, deadline_at: null, deadline_date: "2026-10-10" }, reminders: [local] }, now)[0].due_at, "2026-10-09T17:00:00Z");
  for (const patch of [{ status: "DONE" }, { status: "CANCELLED" }, { deadline_at: null }]) assert.deepEqual(planSource({ ...input, source: { ...task, ...patch } as Task }, now), []);
  assert.throws(() => validateReminders([local, local]));
  assert.throws(() => validateReminders([{ ...local, kind: "ABSOLUTE", scheduled_at: "2026-10-10T10:00Z", days_before: null, local_time: null }], true));
  assert.equal(pushErrorCode({ statusCode: 410, body: "secret" }), "410"); assert.equal(pushErrorCode(new Error("endpoint secret")), "TEMPORARY");
});
