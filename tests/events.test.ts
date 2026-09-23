import assert from "node:assert/strict";
import { test } from "node:test";
import { endDay, formatTiming, instantToLocal, localToInstant, monthDays, onDate, startDay } from "../src/features/app/events/dates.ts";
import { expandEvents, occurrenceDates } from "../src/features/app/events/recurrence.ts";
import { makeDraft, validateEvent } from "../src/features/app/events/validation.ts";
import { EVENT_ZONE, type CalendarEvent, type EventOverride } from "../src/features/app/events/types.ts";
import { getAvailableTabs } from "../src/components/admin/navigation.ts";
import type { AppPermission } from "../src/features/app/types.ts";

const categories = [{ key: "ACTIVITY", label: "Activité" }];
function event(patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: "test", title: "Dimanche", description: "", location: "Locaux", category: "ACTIVITY", timezone: EVENT_ZONE,
    all_day: false, start_date: null, end_date: null, starts_at: "2026-03-22T13:00:00Z", ends_at: "2026-03-22T17:00:00Z",
    audience_type: "ALL", status: "SCHEDULED", created_by: null, updated_by: null, created_at: "", updated_at: "", revision: 1,
    frequency: "WEEKLY", recurrence_interval: 1, weekdays: [7], until_date: null, occurrence_count: null, ...patch };
}

test("Brussels timed conversion, all-day and multi-day dates remain distinct", () => {
  assert.equal(localToInstant("2026-10-16T18:00"), "2026-10-16T16:00:00Z");
  assert.equal(instantToLocal("2026-10-18T12:00:00Z"), "2026-10-18T14:00");
  const draft = { ...makeDraft(undefined, [], "2026-07-16"), title: "Camp", all_day: true, start: "2026-07-16", end: "2026-07-30" };
  const input = validateEvent(draft, categories);
  assert.equal(input.start_date, "2026-07-16"); assert.equal(input.end_date, "2026-07-30");
  assert.equal(input.starts_at, null); assert.equal(input.ends_at, null);
  assert.match(formatTiming(input), /16 juillet 2026.*30 juillet 2026.*Toute la journée/);
  assert.throws(() => validateEvent({ ...draft, end: "2026-07-15" }, categories), /fin/);
  assert.throws(() => validateEvent({ ...draft, start: "2026-02-30" }, categories));
  assert.throws(() => validateEvent({ ...draft, title: " " }, categories));
  assert.throws(() => validateEvent({ ...draft, category: "UNKNOWN" }, categories));
  assert.equal(monthDays("2026-03-01").length, 42);
});

test("explicit DST gap and overlap inputs are rejected", () => {
  assert.throws(() => localToInstant("2026-03-29T02:30"), /inexistante ou doublée/);
  assert.throws(() => localToInstant("2026-10-25T02:30"), /inexistante ou doublée/);
  assert.equal(localToInstant("2026-03-29T03:30"), "2026-03-29T01:30:00Z");
  assert.equal(localToInstant("2026-10-25T03:30"), "2026-10-25T02:30:00Z");
});

test("weekly Sunday 14:00 stays at 14:00 through both DST transitions", () => {
  const spring = expandEvents([event()], [], "2026-03-22", "2026-04-05");
  assert.equal(spring.length, 3);
  assert.deepEqual(spring.map(item => instantToLocal(item.starts_at!)), ["2026-03-22T14:00", "2026-03-29T14:00", "2026-04-05T14:00"]);
  assert.deepEqual(spring.map(item => item.starts_at), ["2026-03-22T13:00:00Z", "2026-03-29T12:00:00Z", "2026-04-05T12:00:00Z"]);
  const fall = event({ starts_at: "2026-10-18T12:00:00Z", ends_at: "2026-10-18T16:00:00Z" });
  assert.deepEqual(expandEvents([fall], [], "2026-10-18", "2026-11-01").map(item => instantToLocal(item.starts_at!)),
    ["2026-10-18T14:00", "2026-10-25T14:00", "2026-11-01T14:00"]);
});

test("DST recurrence disambiguation is later, and multi-day local endpoints survive DST", () => {
  const early = event({ starts_at: "2026-03-22T01:30:00Z", ends_at: "2026-03-22T03:00:00Z" });
  assert.equal(instantToLocal(onDate(early, "2026-03-29").starts_at!), "2026-03-29T03:30");
  const late = event({ starts_at: "2026-10-18T00:30:00Z", ends_at: "2026-10-18T02:00:00Z" });
  assert.equal(onDate(late, "2026-10-25").starts_at, "2026-10-25T01:30:00Z");
  const short = event({ starts_at: "2026-03-22T01:30:00Z", ends_at: "2026-03-22T02:00:00Z" });
  assert.equal(instantToLocal(onDate(short, "2026-03-29").ends_at!), "2026-03-29T04:00");
  const weekend = event({ starts_at: "2026-03-20T17:00:00Z", ends_at: "2026-03-22T13:00:00Z", weekdays: [5] });
  const shifted = onDate(weekend, "2026-03-27");
  assert.equal(instantToLocal(shifted.starts_at!), "2026-03-27T18:00");
  assert.equal(instantToLocal(shifted.ends_at!), "2026-03-29T14:00");
});

test("interval, weekdays, until and count limit recurrence without materializing rows", () => {
  assert.deepEqual(occurrenceDates(event({ recurrence_interval: 2, occurrence_count: 3 }), "2026-05-30"), ["2026-03-22", "2026-04-05", "2026-04-19"]);
  assert.deepEqual(occurrenceDates(event({ weekdays: [3, 7], until_date: "2026-03-29" }), "2026-05-30"), ["2026-03-22", "2026-03-25", "2026-03-29"]);
  const monthly = event({ all_day: true, start_date: "2026-01-31", end_date: "2026-02-02", starts_at: null, ends_at: null,
    frequency: "MONTHLY", weekdays: [], occurrence_count: 3 });
  assert.deepEqual(occurrenceDates(monthly, "2026-07-31"), ["2026-01-31", "2026-03-31", "2026-05-31"]);
  const camp = { ...monthly, frequency: "NONE" as const, occurrence_count: null };
  const overlap = expandEvents([camp], [], "2026-02-01", "2026-02-28");
  assert.equal(overlap.length, 1); assert.equal(endDay(overlap[0]), "2026-02-02");
});

test("overrides move in/out of windows, cancel one occurrence, and leave the series intact", () => {
  const original = event();
  const override: EventOverride = { ...original, event_id: original.id, occurrence_date: "2026-04-05",
    starts_at: "2026-03-27T18:00:00Z", ends_at: "2026-03-27T20:00:00Z", title: "Déplacé", updated_at: "", updated_by: null };
  const movedIn = expandEvents([original], [override], "2026-03-23", "2026-03-29");
  assert.deepEqual(movedIn.map(item => item.title), ["Déplacé", "Dimanche"]);
  assert.equal(expandEvents([original], [override], "2026-04-05", "2026-04-05").length, 0);
  const cancelled = { ...override, status: "CANCELLED" as const };
  assert.equal(expandEvents([original], [cancelled], "2026-03-27", "2026-03-27")[0].status, "CANCELLED");
  assert.equal(original.title, "Dimanche"); assert.equal(original.status, "SCHEDULED");
  const renamed = { ...original, title: "Nouvelle série" };
  assert.equal(expandEvents([renamed], [override], "2026-03-29", "2026-03-29")[0].title, "Nouvelle série");
  assert.equal(expandEvents([{ ...original, status: "CANCELLED" }], [override], "2026-03-27", "2026-03-27")[0].status, "CANCELLED");
  assert.equal(startDay(movedIn[0]), "2026-03-27");
});

test("Agenda navigation requires APP plus events.read, independent of SITE", () => {
  const profile = { user_id: "x", email: "", full_name: "", role: "admin" as const, managedGroupSlugs: [], created_at: "" };
  assert.equal(getAvailableTabs(profile).some(tab => tab.id === "app-agenda"), false);
  assert.equal(getAvailableTabs(profile, ["events.read"]).some(tab => tab.id === "app-agenda"), false);
  const permissions: AppPermission[] = ["app.access", "events.read", "members.read"];
  assert.deepEqual(getAvailableTabs({ ...profile, role: "none" }, permissions).map(tab => tab.id), ["app-home", "app-agenda", "app-tasks", "app-members", "app-notifications", "app-settings"]);
});
