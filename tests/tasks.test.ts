import assert from "node:assert/strict";
import { test } from "node:test";
import { canCompleteTask, canManageTask, taskProgress } from "../src/features/app/tasks/access.ts";
import { deadlineDay, isOverdue, sortTasks } from "../src/features/app/tasks/dates.ts";
import { makeTaskDraft, validateTask } from "../src/features/app/tasks/validation.ts";
import type { Task, TaskMember } from "../src/features/app/tasks/types.ts";
import type { AppAccess, Member } from "../src/features/app/types.ts";

const task: Task = { id: "task", scope: "TEAM", owner_member_id: null, owner_user_id: null, title: "Souper", description: "", status: "IN_PROGRESS", priority: "NORMAL", deadline_date: null, deadline_at: null, timezone: "Europe/Brussels", event_id: null, event_occurrence_date: null, created_by: "creator", updated_by: "creator", created_at: "", updated_at: "", revision: 1 };
const member: Member = { id: "member", user_id: "user", first_name: "Alex", last_name: "Exemple", active: true, created_at: "", updated_at: "" };
const access: AppAccess = { member, roles: [], permissions: ["app.access"] };
const assignment: TaskMember = { task_id: task.id, member_id: member.id, role: "CONTRIBUTOR", work_status: "TODO", created_at: "", updated_at: "" };

test("Tasks civil deadlines include the whole Brussels day across both DST changes", () => {
  for (const [day, last, next] of [["2026-03-29", "2026-03-29T21:59:59Z", "2026-03-29T22:00:00Z"], ["2026-10-25", "2026-10-25T22:59:59Z", "2026-10-25T23:00:00Z"]]) {
    const dated = { ...task, deadline_date: day };
    assert.equal(isOverdue(dated, last), false);
    assert.equal(isOverdue(dated, next), true);
    assert.equal(isOverdue({ ...dated, status: "DONE" }, next), false);
    assert.equal(isOverdue({ ...dated, status: "CANCELLED" }, next), false);
  }
  assert.equal(isOverdue(task, "2026-09-23T12:00Z"), false);
  const timed = { ...task, deadline_at: "2026-09-23T22:30:00Z" };
  assert.equal(deadlineDay(timed), "2026-09-24");
  assert.equal(isOverdue(timed, timed.deadline_at), false);
  assert.equal(isOverdue(timed, "2026-09-23T22:30:01Z"), true);
});

test("Tasks validation converts local times and rejects DST gaps/overlaps and invalid civil dates", () => {
  const draft = { ...makeTaskDraft("PERSONAL"), title: "  Privée  " };
  assert.equal(validateTask(draft, [], []).details.title, "Privée");
  assert.equal(validateTask(draft, [], []).details.deadline_at, null);
  assert.equal(validateTask({ ...draft, deadline_kind: "TIMED", deadline: "2026-10-24T19:00" }, [], []).details.deadline_at, "2026-10-24T17:00:00Z");
  for (const deadline of ["2026-03-29T02:30", "2026-10-25T02:30"]) assert.throws(() => validateTask({ ...draft, deadline_kind: "TIMED", deadline }, [], []));
  assert.throws(() => validateTask({ ...draft, deadline_kind: "DATE", deadline: "2026-02-30" }, [], []));
  assert.throws(() => validateTask({ ...draft, assignments: [assignment] }, [member], []));
  assert.throws(() => validateTask({ ...draft, event_id: "event" }, [], []));
});

test("Tasks validation enforces unique members, at least one lead, and preserves historical archived assignments", () => {
  const draft = { ...makeTaskDraft("TEAM"), title: "Équipe" };
  assert.throws(() => validateTask(draft, [member], []));
  assert.throws(() => validateTask({ ...draft, assignments: [assignment] }, [member], []));
  const lead = { ...assignment, role: "LEAD" as const };
  assert.throws(() => validateTask({ ...draft, assignments: [lead, assignment] }, [member], []));
  assert.equal(validateTask({ ...draft, assignments: [lead] }, [member], []).assignments.length, 1);
  const archived = { ...member, active: false };
  assert.throws(() => validateTask({ ...draft, assignments: [lead] }, [archived], []));
  assert.equal(validateTask({ ...draft, assignments: [lead] }, [archived], [], task, [lead]).assignments.length, 1);
});

test("Tasks UI permissions distinguish creator, lead, contributor and personal owner without an administrator bypass", () => {
  assert.equal(canManageTask(task, [assignment], access, "user"), false);
  assert.equal(canCompleteTask(task, [assignment], access, "user"), false);
  const lead = { ...assignment, role: "LEAD" as const };
  assert.equal(canManageTask(task, [lead], access, "user"), true);
  assert.equal(canCompleteTask(task, [lead], access, "user"), true);
  const creator: AppAccess = { ...access, permissions: ["app.access", "tasks.create_team"] };
  assert.equal(canManageTask(task, [], creator, "creator"), true);
  assert.equal(canCompleteTask(task, [], creator, "creator"), false);
  const admin: AppAccess = { ...access, permissions: ["app.access", "tasks.manage_all"] };
  assert.equal(canCompleteTask(task, [], admin, "admin"), true);
  const personal = { ...task, scope: "PERSONAL" as const, owner_member_id: member.id, owner_user_id: "user" };
  assert.equal(canManageTask(personal, [], access, "user"), true);
  assert.equal(canManageTask(personal, [], admin, "admin"), false);
  assert.equal(canManageTask(personal, [], { ...access, member: null }, "user"), false);
  assert.equal(canCompleteTask(task, [lead], { ...access, permissions: [] }, "user"), false);
  assert.deepEqual(taskProgress(task.id, [assignment, { ...lead, member_id: "other", work_status: "DONE" }, { ...assignment, task_id: "elsewhere" }]), { total: 2, done: 1 });
});

test("Task sorting prioritizes overdue deadlines, then imminent tasks and priority without mutating input", () => {
  const rows: Task[] = [{ ...task, id: "none" }, { ...task, id: "closed", status: "DONE", deadline_date: "2026-01-01" }, { ...task, id: "urgent", priority: "URGENT", deadline_date: "2026-09-24" }, { ...task, id: "normal", deadline_date: "2026-09-24" }, { ...task, id: "late", deadline_date: "2026-09-22" }];
  assert.deepEqual(sortTasks(rows, "2026-09-23T12:00Z").map(row => row.id), ["late", "urgent", "normal", "none", "closed"]);
  assert.equal(rows[0].id, "none");
  // The two Brussels 02:30 instants on the autumn transition remain chronologically ordered.
  const overlap: Task[] = [{...task,id:"later",deadline_at:"2026-10-25T01:30:00Z",priority:"URGENT"},{...task,id:"earlier",deadline_at:"2026-10-25T00:30:00Z"}];
  assert.deepEqual(sortTasks(overlap,"2026-10-24T12:00:00Z").map(row => row.id),["earlier","later"]);
});
