import { useEffect, useRef, useState } from "preact/hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppAccess } from "../../types";
import { canCompleteTask, canManageTask, personalAssignment, taskProgress } from "../access";
import { loadTaskActivity, taskError, type TasksData } from "../data";
import { formatDeadline, isOverdue } from "../dates";
import { formatDay, formatTime, instantToLocal } from "../../events/dates";
import { priorityLabels, roleLabels, statusLabels, type Task, type TaskAction, type TaskActivity } from "../types";
import { linkedEventLabel, memberName, WorkButton } from "./TaskCard";

const actionLabels: Record<TaskAction, string> = { TASK_CREATED: "Tâche créée", TASK_UPDATED: "Tâche modifiée", STATUS_CHANGED: "Statut modifié", TASK_CANCELLED: "Tâche annulée",
  MEMBER_ADDED: "Membre ajouté", MEMBER_REMOVED: "Membre retiré", MEMBER_ROLE_CHANGED: "Rôle dans la tâche modifié", MEMBER_WORK_COMPLETED: "Partie terminée", MEMBER_WORK_REOPENED: "Partie remise à faire" };
export default function TaskDetail({ task, data, client, access, userId, busy, onEdit, onClose, onWork, onStatus }: {
  task: Task; data: TasksData; client: SupabaseClient; access: AppAccess; userId: string; busy: boolean;
  onEdit: () => void; onClose: () => void; onWork: (task: Task, done: boolean) => void; onStatus: (status: Task["status"]) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [activity, setActivity] = useState<TaskActivity[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError("");
    loadTaskActivity(client, task.id).then(rows => { if (active) setActivity(rows); }).catch(cause => { if (active) setError(taskError(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, task.id, task.revision, attempt]);
  const own = personalAssignment(task, data.assignments, access), progress = taskProgress(task.id, data.assignments);
  const manage = canManageTask(task, data.assignments, access, userId), complete = canCompleteTask(task, data.assignments, access, userId);
  return <section class="admin-subpanel task-detail">
    <h2 ref={heading} tabIndex={-1}>{task.title}</h2>
    <p>{task.scope === "PERSONAL" ? "Personnel · privé" : "Équipe"} · {statusLabels[task.status]} · Priorité {priorityLabels[task.priority].toLocaleLowerCase("fr")}</p>
    {isOverdue(task) && <strong class="task-overdue">En retard</strong>}
    <p>Échéance : {formatDeadline(task)}</p>{task.description && <p class="task-description">{task.description}</p>}
    {task.event_id && <p>Événement : {linkedEventLabel(task, data)}</p>}
    {task.scope === "TEAM" && <><p>{progress.done} / {progress.total} personnes terminées</p><ul>{data.assignments.filter(item => item.task_id === task.id).map(item => <li key={item.member_id}>{memberName(item.member_id, data)} · {roleLabels[item.role]} · {item.work_status === "DONE" ? "Partie terminée" : "À faire"}</li>)}</ul></>}
    <div class="task-actions"><WorkButton task={task} own={own} busy={busy} onWork={onWork} />
      {manage && <button class="btn" type="button" disabled={busy} onClick={onEdit}>Modifier</button>}
      {complete && task.status !== "DONE" && task.status !== "CANCELLED" && <button class="btn" type="button" disabled={busy} onClick={() => onStatus("DONE")}>Terminer la tâche</button>}
      {manage && task.status !== "CANCELLED" && <button class="btn btn-light" type="button" disabled={busy} onClick={() => onStatus("CANCELLED")}>Annuler la tâche</button>}
      <button class="btn btn-light" type="button" disabled={busy} onClick={onClose}>Fermer la fiche</button>
    </div>
    <h3>Historique récent</h3>
    {loading ? <p role="status">Chargement de l’historique…</p> : error ? <p role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>Réessayer</button></p> : <ol class="task-audit">{activity.map(row => {
      const actor = data.members.find(member => member.user_id === row.actor_id);
      return <li key={row.id}><strong>{actionLabels[row.action]}</strong> · {formatDay(instantToLocal(row.created_at).slice(0, 10), false)} à {formatTime(row.created_at)}
        <span> · {row.actor_id === userId ? "Vous" : actor ? `${actor.first_name} ${actor.last_name}` : "Compte authentifié (identité indisponible)"}</span>
        {row.metadata.member_id && <span> · {memberName(row.metadata.member_id, data)}</span>}
      </li>;
    })}</ol>}
    <p class="muted">Les 100 dernières actions sont affichées. Le statut individuel ne clôture pas la tâche globale.</p>
  </section>;
}
