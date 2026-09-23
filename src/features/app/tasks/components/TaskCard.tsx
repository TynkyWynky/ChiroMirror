import type { AppAccess } from "../../types";
import type { TasksData } from "../data";
import { personalAssignment, taskProgress } from "../access";
import { formatDeadline, isOverdue } from "../dates";
import { formatDay } from "../../events/dates";
import { priorityLabels, roleLabels, statusLabels, type Task, type TaskMember } from "../types";

export function memberName(memberId: string, data: TasksData) {
  const member = data.members.find(item => item.id === memberId);
  return member ? `${member.first_name} ${member.last_name}${member.active ? "" : " (archivé)"}` : "Membre non consultable";
}
export function linkedEventLabel(task: Task, data: TasksData) {
  if (!task.event_id) return "";
  const event = data.events.find(item => item.id === task.event_id);
  const override = data.overrides.find(item => item.event_id === task.event_id && item.occurrence_date === task.event_occurrence_date);
  return `${event?.title ?? "Événement non consultable"}${task.event_occurrence_date ? ` · occurrence d’origine du ${formatDay(task.event_occurrence_date, false)}` : ""}${event?.status === "CANCELLED" || override?.status === "CANCELLED" ? " · événement/occurrence annulé(e)" : ""}`;
}
export function WorkButton({ task, own, busy, onWork }: { task: Task; own?: TaskMember; busy: boolean; onWork: (task: Task, done: boolean) => void }) {
  return own && task.status !== "CANCELLED" ? <button class="btn btn-light" type="button" disabled={busy} onClick={() => onWork(task, own.work_status !== "DONE")}>{own.work_status === "DONE" ? "Remettre ma partie à faire" : "✓ J’ai terminé"}</button> : null;
}
export default function TaskCard({ task, data, access, busy, onSelect, onWork }: { task: Task; data: TasksData; access: AppAccess; busy: boolean; onSelect: (task: Task) => void; onWork: (task: Task, done: boolean) => void }) {
  const own = personalAssignment(task, data.assignments, access), progress = taskProgress(task.id, data.assignments);
  const leads = data.assignments.filter(item => item.task_id === task.id && item.role === "LEAD");
  return <li class="admin-subpanel task-card">
    <div class="task-tags"><span>{task.scope === "PERSONAL" ? "Personnel · privé" : "Équipe"}</span><span>{priorityLabels[task.priority]}</span><span>{statusLabels[task.status]}</span>{isOverdue(task) && <strong class="task-overdue">En retard</strong>}</div>
    <h2><button type="button" class="task-title" onClick={() => onSelect(task)}>{task.title}</button></h2>
    <p>Échéance : {formatDeadline(task)}</p>
    {task.event_id && <p>Événement : {linkedEventLabel(task, data)}</p>}
    {task.scope === "TEAM" && <><p>Responsables : {leads.map(item => memberName(item.member_id, data)).join(" + ")}</p><p>{progress.done} / {progress.total} personnes terminées</p></>}
    {own && <p>Mon rôle : {roleLabels[own.role]} · Ma partie : {own.work_status === "DONE" ? "Terminée" : "À faire"}</p>}
    <WorkButton task={task} own={own} busy={busy} onWork={onWork} />
  </li>;
}
