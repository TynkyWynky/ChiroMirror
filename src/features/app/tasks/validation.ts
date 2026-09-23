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
  if (!title || title.length > 200) throw new Error("Le titre est obligatoire (200 caractères maximum).");
  if (description.length > 10000) throw new Error("La description est trop longue.");
  if (!Object.hasOwn(statusLabels, draft.status) || !Object.hasOwn(priorityLabels, draft.priority)) throw new Error("Statut ou priorité invalide.");
  if (!["TEAM", "PERSONAL"].includes(draft.scope) || !["NONE", "DATE", "TIMED"].includes(draft.deadline_kind)) throw new Error("Type de tâche ou d’échéance invalide.");
  const deadline_date = draft.deadline_kind === "DATE" ? civil(draft.deadline).toString() : null;
  const deadline_at = draft.deadline_kind === "TIMED" ? localToInstant(draft.deadline) : null;
  if (draft.scope === "PERSONAL" && (draft.assignments.length || draft.event_id || draft.event_occurrence_date)) throw new Error("Une tâche personnelle ne peut pas avoir de collaborateurs ou d’événement.");
  if (draft.scope === "TEAM") {
    if (!draft.assignments.some(member => member.role === "LEAD")) throw new Error("Choisissez au moins un responsable.");
    if (new Set(draft.assignments.map(item => item.member_id)).size !== draft.assignments.length) throw new Error("Un membre ne peut apparaître qu’une fois.");
    for (const assignment of draft.assignments) {
      const member = members.find(item => item.id === assignment.member_id);
      if (!member || !["LEAD", "CONTRIBUTOR"].includes(assignment.role) || (!member.active && !original.some(item => item.member_id === member.id))) throw new Error("Un membre sélectionné est inexistant ou archivé.");
    }
  }
  if (draft.event_occurrence_date && !draft.event_id) throw new Error("Choisissez un événement avant son occurrence.");
  const changedLink = draft.event_id !== (previous?.event_id ?? "") || draft.event_occurrence_date !== (previous?.event_occurrence_date ?? "");
  if (draft.event_id && changedLink) {
    const event = events.find(item => item.id === draft.event_id);
    if (!event) throw new Error("Événement introuvable.");
    if (draft.event_occurrence_date) {
      civil(draft.event_occurrence_date);
      if (event.frequency === "NONE" || !occurrenceDates(event, draft.event_occurrence_date).includes(draft.event_occurrence_date)) throw new Error("Cette date ne correspond pas à une occurrence d’origine de la série.");
    }
  }
  return { details: { scope: draft.scope, title, description, status: draft.status, priority: draft.priority, deadline_date, deadline_at,
    timezone: "Europe/Brussels", event_id: draft.event_id || null, event_occurrence_date: draft.event_occurrence_date || null }, assignments: draft.assignments };
}
