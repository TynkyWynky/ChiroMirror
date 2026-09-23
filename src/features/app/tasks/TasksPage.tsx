import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasAppPermission } from "../access";
import type { AppAccess } from "../types";
import { today } from "../events/dates";
import { canCompleteTask, personalAssignment, taskProgress } from "./access";
import { deadlineDay, isOverdue, sortTasks } from "./dates";
import { emptyTasks, loadTasks, saveTask, setMyWorkStatus, taskError, type TasksData } from "./data";
import { priorityLabels, statusLabels, type Task, type TaskAssignment, type TaskInput, type TaskScope } from "./types";
import TaskForm from "./components/TaskForm";
import TaskDetail from "./components/TaskDetail";
import TaskCard from "./components/TaskCard";
import "./tasks.css";

export default function TasksPage({ client, access, userId, openTaskId, onTargetHandled }: { client: SupabaseClient; access: AppAccess; userId: string; openTaskId?: string; onTargetHandled?: () => void }) {
  const [data, setData] = useState<TasksData>(emptyTasks), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [feedback, setFeedback] = useState("");
  const [view, setView] = useState("mine"), [search, setSearch] = useState(""), [priority, setPriority] = useState(""), [status, setStatus] = useState("active"), [deadline, setDeadline] = useState(""), [eventId, setEventId] = useState("");
  const [selected, setSelected] = useState<string | null>(null), [editing, setEditing] = useState<{ task: Task | null; scope: TaskScope } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 700px)").matches);
  const requestId = useRef(0), returnFocus = useRef<HTMLElement | null>(null);
  const readAll = hasAppPermission(access.permissions, "tasks.read_all") || hasAppPermission(access.permissions, "tasks.manage_all");
  const createTeam = hasAppPermission(access.permissions, "tasks.create_team");
  async function reload() {
    const id = ++requestId.current; setLoading(true); setError("");
    try { const result = await loadTasks(client, access); if (id === requestId.current) setData(result); }
    catch (cause) { if (id === requestId.current) { setData(emptyTasks); setError(taskError(cause)); } }
    finally { if (id === requestId.current) setLoading(false); }
  }
  useEffect(() => { void reload(); return () => { requestId.current++; }; }, [client, access]);
  useEffect(() => {
    if (loading || !openTaskId) return;
    if (data.tasks.some(t => t.id === openTaskId)) setSelected(openTaskId); else setError("Cette tâche n’est plus accessible avec votre compte.");
    onTargetHandled?.();
  }, [loading, openTaskId, data]);
  const visible = useMemo(() => sortTasks(data.tasks.filter(task => {
    const own = personalAssignment(task, data.assignments, access);
    const mine = task.scope === "PERSONAL" ? task.owner_member_id === access.member?.id && task.owner_user_id === userId : Boolean(own);
    const closed = task.status === "DONE" || task.status === "CANCELLED";
    if (view === "mine" && !mine || view === "leads" && own?.role !== "LEAD" || view === "all" && (!readAll || task.scope !== "TEAM") || view === "closed" && !closed) return false;
    if (view !== "closed" && (status === "active" ? closed : status && task.status !== status)) return false;
    if (priority && task.priority !== priority || eventId && task.event_id !== eventId) return false;
    if (deadline === "overdue" && !isOverdue(task) || deadline === "today" && deadlineDay(task) !== today() || deadline === "none" && deadlineDay(task)) return false;
    return `${task.title} ${task.description ?? ""}`.toLocaleLowerCase("fr").includes(search.trim().toLocaleLowerCase("fr"));
  })), [data, access, userId, view, readAll, search, priority, status, deadline, eventId]);
  function restoreFocus() { requestAnimationFrame(() => returnFocus.current?.isConnected && returnFocus.current.focus()); }
  function close() { setSelected(null); setEditing(null); setError(""); restoreFocus(); }
  function open(task: Task) { returnFocus.current = document.activeElement as HTMLElement; setSelected(task.id); setFeedback(""); setError(""); }
  async function mutate(action: () => Promise<void>, message: string, closeEditor = false) {
    if (busy) return;
    setBusy(true); setError(""); setFeedback("");
    try { await action(); if (closeEditor) setEditing(null); setFeedback(message); await reload(); if (closeEditor) restoreFocus(); }
    catch (cause) { setError(taskError(cause)); }
    finally { setBusy(false); }
  }
  function newTask(scope: TaskScope) { returnFocus.current = document.activeElement as HTMLElement; setSelected(null); setEditing({ task: null, scope }); setError(""); setFeedback(""); }
  const selectedTask = data.tasks.find(task => task.id === selected);
  function work(task: Task, done: boolean) { void mutate(() => setMyWorkStatus(client, task, done ? "DONE" : "TODO"), done ? "Votre partie est terminée. Le statut global reste inchangé." : "Votre partie est remise à faire."); }
  async function submit(details: TaskInput, assignments: TaskAssignment[]) {
    if (editing) await mutate(() => saveTask(client, editing.task, details, assignments), "Tâche enregistrée.", true);
  }
  function changeStatus(next: Task["status"]) {
    if (!selectedTask) return;
    const progress = taskProgress(selectedTask.id, data.assignments), pending = progress.total - progress.done;
    const question = next === "CANCELLED" ? "Annuler cette tâche ? Son historique sera conservé." : pending ? `${pending} personne(s) n’ont pas encore terminé leur partie. Terminer quand même la tâche ?` : "Marquer cette tâche comme terminée ?";
    if (!window.confirm(question)) return;
    const { scope, title, description, priority, deadline_date, deadline_at, timezone, event_id, event_occurrence_date } = selectedTask;
    void mutate(() => saveTask(client, selectedTask, { scope, title, description: description ?? "", priority, deadline_date, deadline_at, timezone, event_id, event_occurrence_date, status: next },
      data.assignments.filter(item => item.task_id === selectedTask.id).map(({ member_id, role }) => ({ member_id, role }))), next === "DONE" ? "Tâche terminée." : "Tâche annulée.");
  }
  return <section class="admin-panel tasks" lang="fr" aria-busy={loading || busy}>
    <header class="admin-page-heading"><div><p class="admin-eyebrow">APP</p><h1>Tâches</h1><p>Vos actions, vos responsabilités et le travail de l’équipe.</p></div>
      <div class="task-actions"><button class="btn" type="button" disabled={loading || busy || Boolean(editing) || !access.member?.active} onClick={() => newTask("PERSONAL")}>+ Tâche personnelle</button>
        {createTeam && <button class="btn" type="button" disabled={loading || busy || Boolean(editing)} onClick={() => newTask("TEAM")}>+ Tâche d’équipe</button>}</div>
    </header>
    {!access.member && <p>Votre compte n’est pas lié à un membre. Un membre actif est nécessaire pour créer vos tâches personnelles et recevoir des affectations.</p>}
    {feedback && <p role="status" class="task-feedback">{feedback}</p>}
    {error && !editing && <p role="alert" class="task-error">{error} <button type="button" class="btn btn-light" disabled={busy} onClick={() => void reload()}>Réessayer</button></p>}
    {editing ? <TaskForm key={editing.task?.id ?? editing.scope} task={editing.task} scope={editing.scope} data={data} busy={busy} error={error}
      canComplete={editing.task ? canCompleteTask(editing.task, data.assignments, access, userId) : editing.scope === "PERSONAL" || hasAppPermission(access.permissions, "tasks.manage_all")}
      onSave={submit} onClose={close} />
      : selectedTask ? <TaskDetail task={selectedTask} data={data} client={client} access={access} userId={userId} busy={busy} onEdit={() => setEditing({ task: selectedTask, scope: selectedTask.scope })} onClose={close} onWork={work} onStatus={changeStatus} />
      : <>
        <div class="task-actions" role="group" aria-label="Vue des tâches">{[["mine", "Mes tâches"], ["leads", "Je supervise"], ...(readAll ? [["all", "Toutes"]] : []), ["closed", "Terminées / annulées"]].map(([key, label]) => <button class="btn btn-light" type="button" key={key} aria-pressed={view === key} onClick={() => { setView(key); setSelected(null); }}>{label}</button>)}</div>
        <details class="task-filter-panel" open={filtersOpen} onToggle={e => setFiltersOpen(e.currentTarget.open)}><summary>Recherche et filtres</summary>
        <div class="task-fields task-filters"><label>Recherche<input type="search" value={search} onInput={e => setSearch(e.currentTarget.value)} /></label>
          <label>Filtrer le statut<select aria-label="Filtrer le statut" value={status} disabled={view === "closed"} onChange={e => setStatus(e.currentTarget.value)}><option value="active">Actives</option><option value="">Tous</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Filtrer la priorité<select aria-label="Filtrer la priorité" value={priority} onChange={e => setPriority(e.currentTarget.value)}><option value="">Toutes</option>{Object.entries(priorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Filtrer l’échéance<select aria-label="Filtrer l’échéance" value={deadline} onChange={e => setDeadline(e.currentTarget.value)}><option value="">Toutes</option><option value="overdue">En retard</option><option value="today">Aujourd’hui</option><option value="none">Sans échéance</option></select></label>
          <label>Filtrer l’événement<select aria-label="Filtrer l’événement" value={eventId} onChange={e => setEventId(e.currentTarget.value)}><option value="">Tous</option>{data.events.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>
        </div></details>
        <button class="btn btn-light" type="button" disabled={loading || busy} onClick={() => { setSelected(null); void reload(); }}>Actualiser les tâches</button>
        {loading ? <p role="status">Chargement des tâches…</p> : !error && <>
          {!visible.length && <p>Aucune tâche pour cette vue. Modifiez vos filtres ou créez une tâche.</p>}
          <ul class="task-list">{visible.map(task => <TaskCard key={task.id} task={task} data={data} access={access} busy={busy} onSelect={open} onWork={work} />)}</ul>
        </>}
      </>}
  </section>;
}
