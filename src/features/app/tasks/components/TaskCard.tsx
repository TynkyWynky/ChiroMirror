import type { AppAccess } from "../../types";
import type { TasksData } from "../data";
import { personalAssignment, taskProgress } from "../access";
import { formatDeadline, isOverdue } from "../dates";
import { formatDay } from "../../events/dates";
import { priorityLabels, roleLabels, statusLabels, type Task, type TaskMember } from "../types";

export function memberName(memberId: string, data: TasksData) {
  const member = data.members.find(item => item.id === memberId);
  return member ? `${member.first_name} ${member.last_name}${member.active ? "" : " (gearchiveerd)"}` : "Lid niet zichtbaar";
}
export function linkedEventLabel(task: Task, data: TasksData) {
  if (!task.event_id) return "";
  const event = data.events.find(item => item.id === task.event_id);
  const override = data.overrides.find(item => item.event_id === task.event_id && item.occurrence_date === task.event_occurrence_date);
  return `${event?.title ?? "Activiteit niet zichtbaar"}${task.event_occurrence_date ? ` · oorspronkelijk exemplaar van ${formatDay(task.event_occurrence_date, false)}` : ""}${event?.status === "CANCELLED" || override?.status === "CANCELLED" ? " · activiteit/exemplaar geannuleerd" : ""}`;
}
export function WorkButton({ task, own, busy, onWork }: { task: Task; own?: TaskMember; busy: boolean; onWork: (task: Task, done: boolean) => void }) {
  return own && task.status !== "CANCELLED" ? <button class="btn btn-light" type="button" disabled={busy} onClick={() => onWork(task, own.work_status !== "DONE")}>{own.work_status === "DONE" ? "Mijn deel opnieuw openzetten" : "✓ Mijn deel is klaar"}</button> : null;
}
export default function TaskCard({ task, data, access, busy, onSelect, onWork }: { task: Task; data: TasksData; access: AppAccess; busy: boolean; onSelect: (task: Task) => void; onWork: (task: Task, done: boolean) => void }) {
  const own = personalAssignment(task, data.assignments, access), progress = taskProgress(task.id, data.assignments);
  const leads = data.assignments.filter(item => item.task_id === task.id && item.role === "LEAD");
  return <li class="admin-subpanel task-card">
    <div class="task-tags"><span>{task.scope === "PERSONAL" ? "Persoonlijk · privé" : "Team"}</span><span>{priorityLabels[task.priority]}</span><span>{statusLabels[task.status]}</span>{isOverdue(task) && <strong class="task-overdue">Te laat</strong>}</div>
    <h2><button type="button" class="task-title" onClick={() => onSelect(task)}>{task.title}</button></h2>
    <p>Deadline: {formatDeadline(task)}</p>
    {task.event_id && <p>Activiteit: {linkedEventLabel(task, data)}</p>}
    {task.scope === "TEAM" && <><p>Verantwoordelijken: {leads.map(item => memberName(item.member_id, data)).join(" + ")}</p><p>{progress.done} / {progress.total} personen klaar</p></>}
    {own && <p>Mijn rol: {roleLabels[own.role]} · Mijn deel: {own.work_status === "DONE" ? "Afgerond" : "Te doen"}</p>}
    <WorkButton task={task} own={own} busy={busy} onWork={onWork} />
  </li>;
}
