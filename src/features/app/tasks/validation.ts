import { civil, instantToLocal, localToInstant } from "../events/dates.ts";
import { occurrenceDates } from "../events/recurrence.ts";
import type { CalendarEvent } from "../events/types.ts";
import type { Member } from "../types.ts";
import { priorityLabels, statusLabels, type Task, type TaskAssignment, type TaskDraft, type TaskInput } from "./types.ts";

export function makeTaskDraft(scope: TaskDraft["scope"], task?: Task, assignments: TaskAssignment[] = []): TaskDraft {
  return { scope, title: task?.title ?? "", description: task?.description ?? "", status: task?.status ?? "TODO", priority: task?.priority ?? "NORMAL",
    deadline_kind: task?.deadline_date ? "DATE" : task?.deadline_at ? "TIMED" : "NONE", deadline: task?.deadline_date ?? (task?.deadline_at ? instantToLocal(task.deadline_at) : ""),
    event_id: task?.event_id ?? "", event_occurrence_date: task?.event_occurrence_date ?? "", assignments };
}
export function validateTask(draft: TaskDraft, members: Member[], events: CalendarEvent[], previous?: Task, original: TaskAssignment[] = []): { details: TaskInput; assignments: TaskAssignment[] } {
  const title = draft.title.trim(), description = draft.description.trim();
  if (!title || title.length > 200) throw new Error("De titel is verplicht (maximaal 200 tekens).");
  if (description.length > 10000) throw new Error("De beschrijving is te lang.");
  if (!Object.hasOwn(statusLabels, draft.status) || !Object.hasOwn(priorityLabels, draft.priority)) throw new Error("Ongeldige status of prioriteit.");
  if (!["TEAM", "PERSONAL"].includes(draft.scope) || !["NONE", "DATE", "TIMED"].includes(draft.deadline_kind)) throw new Error("Ongeldig taak- of deadlinetype.");
  const deadline_date = draft.deadline_kind === "DATE" ? civil(draft.deadline).toString() : null;
  const deadline_at = draft.deadline_kind === "TIMED" ? localToInstant(draft.deadline) : null;
  if (draft.scope === "PERSONAL" && (draft.assignments.length || draft.event_id || draft.event_occurrence_date)) throw new Error("Een persoonlijke taak kan geen medewerkers of gekoppelde activiteit hebben.");
  if (draft.scope === "TEAM") {
    if (!draft.assignments.some(member => member.role === "LEAD")) throw new Error("Kies minstens één verantwoordelijke.");
    if (new Set(draft.assignments.map(item => item.member_id)).size !== draft.assignments.length) throw new Error("Een lid kan maar één keer voorkomen.");
    for (const assignment of draft.assignments) {
      const member = members.find(item => item.id === assignment.member_id);
      if (!member || !["LEAD", "CONTRIBUTOR"].includes(assignment.role) || (!member.active && !original.some(item => item.member_id === member.id))) throw new Error("Een geselecteerd lid bestaat niet of is gearchiveerd.");
    }
  }
  if (draft.event_occurrence_date && !draft.event_id) throw new Error("Kies een activiteit voordat je een exemplaar kiest.");
  const changedLink = draft.event_id !== (previous?.event_id ?? "") || draft.event_occurrence_date !== (previous?.event_occurrence_date ?? "");
  if (draft.event_id && changedLink) {
    const event = events.find(item => item.id === draft.event_id);
    if (!event) throw new Error("Activiteit niet gevonden.");
    if (draft.event_occurrence_date) {
      civil(draft.event_occurrence_date);
      if (event.frequency === "NONE" || !occurrenceDates(event, draft.event_occurrence_date).includes(draft.event_occurrence_date)) throw new Error("Deze datum komt niet overeen met een oorspronkelijk exemplaar van de reeks.");
    }
  }
  return { details: { scope: draft.scope, title, description, status: draft.status, priority: draft.priority, deadline_date, deadline_at,
    timezone: "Europe/Brussels", event_id: draft.event_id || null, event_occurrence_date: draft.event_occurrence_date || null }, assignments: draft.assignments };
}
