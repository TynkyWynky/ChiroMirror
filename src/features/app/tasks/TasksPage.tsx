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

export default function TasksPage({ client, access, userId, openTaskId, onTargetHandled, onResourceOpen, onResourceClose }: { client: SupabaseClient; access: AppAccess; userId: string; openTaskId?: string; onTargetHandled?: () => void; onResourceOpen?: (id:string)=>void; onResourceClose?: ()=>void }) {
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
    if (loading) return;
    if (!openTaskId) { if(onResourceClose){setSelected(null);setEditing(null);} return; }
    if (data.tasks.some(t => t.id === openTaskId)) setSelected(openTaskId); else setError("Deze taak is niet meer toegankelijk met jouw account.");
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
    return `${task.title} ${task.description ?? ""}`.toLocaleLowerCase("nl").includes(search.trim().toLocaleLowerCase("nl"));
  })), [data, access, userId, view, readAll, search, priority, status, deadline, eventId]);
  function restoreFocus() { requestAnimationFrame(() => returnFocus.current?.isConnected && returnFocus.current.focus()); }
  function close() { onResourceClose?.(); setSelected(null); setEditing(null); setError(""); restoreFocus(); }
  function open(task: Task) { onResourceOpen?.(task.id); returnFocus.current = document.activeElement as HTMLElement; setSelected(task.id); setFeedback(""); setError(""); }
  async function mutate(action: () => Promise<void>, message: string, closeEditor = false) {
    if (busy) return;
    setBusy(true); setError(""); setFeedback("");
    try { await action(); if (closeEditor) setEditing(null); setFeedback(message); await reload(); if (closeEditor) restoreFocus(); }
    catch (cause) { setError(taskError(cause)); }
    finally { setBusy(false); }
  }
  function newTask(scope: TaskScope) { returnFocus.current = document.activeElement as HTMLElement; setSelected(null); setEditing({ task: null, scope }); setError(""); setFeedback(""); }
  const selectedTask = data.tasks.find(task => task.id === selected);
  function work(task: Task, done: boolean) { void mutate(() => setMyWorkStatus(client, task, done ? "DONE" : "TODO"), done ? "Jouw deel is afgerond. De algemene status blijft ongewijzigd." : "Jouw deel staat opnieuw open."); }
  async function submit(details: TaskInput, assignments: TaskAssignment[]) {
    if (editing) await mutate(() => saveTask(client, editing.task, details, assignments), "Taak opgeslagen.", true);
  }
  function changeStatus(next: Task["status"]) {
    if (!selectedTask) return;
    const progress = taskProgress(selectedTask.id, data.assignments), pending = progress.total - progress.done;
    const question = next === "CANCELLED" ? "Deze taak annuleren? De geschiedenis blijft bewaard." : pending ? `${pending} personen hebben hun deel nog niet afgerond. De taak toch afronden?` : "Deze taak als afgerond markeren?";
    if (!window.confirm(question)) return;
    const { scope, title, description, priority, deadline_date, deadline_at, timezone, event_id, event_occurrence_date } = selectedTask;
    void mutate(() => saveTask(client, selectedTask, { scope, title, description: description ?? "", priority, deadline_date, deadline_at, timezone, event_id, event_occurrence_date, status: next },
      data.assignments.filter(item => item.task_id === selectedTask.id).map(({ member_id, role }) => ({ member_id, role }))), next === "DONE" ? "Taak afgerond." : "Taak geannuleerd.");
  }
  return <section class="admin-panel tasks" lang="nl" aria-busy={loading || busy}>
    <header class="admin-page-heading"><div><p class="admin-eyebrow">APP</p><h1>Taken</h1><p>Je acties, verantwoordelijkheden en het werk van je team.</p></div>
      <div class="task-actions"><button class="btn" type="button" disabled={loading || busy || Boolean(editing) || !access.member?.active} onClick={() => newTask("PERSONAL")}>+ Persoonlijke taak</button>
        {createTeam && <button class="btn" type="button" disabled={loading || busy || Boolean(editing)} onClick={() => newTask("TEAM")}>+ Teamtaak</button>}</div>
    </header>
    {!access.member && <p>Je account is niet gekoppeld aan een lid. Een actief lid is vereist om persoonlijke taken aan te maken en toewijzingen te ontvangen.</p>}
    {feedback && <p role="status" class="task-feedback">{feedback}</p>}
    {error && !editing && <p role="alert" class="task-error">{error} <button type="button" class="btn btn-light" disabled={busy} onClick={() => void reload()}>Opnieuw proberen</button></p>}
    {editing ? <TaskForm key={editing.task?.id ?? editing.scope} task={editing.task} scope={editing.scope} data={data} busy={busy} error={error}
      canComplete={editing.task ? canCompleteTask(editing.task, data.assignments, access, userId) : editing.scope === "PERSONAL" || hasAppPermission(access.permissions, "tasks.manage_all")}
      onSave={submit} onClose={close} />
      : selectedTask ? <TaskDetail task={selectedTask} data={data} client={client} access={access} userId={userId} busy={busy} onEdit={() => setEditing({ task: selectedTask, scope: selectedTask.scope })} onClose={close} onWork={work} onStatus={changeStatus} />
      : <>
        <div class="task-actions" role="group" aria-label="Takenweergave">{[["mine", "Mijn taken"], ["leads", "Onder mijn toezicht"], ...(readAll ? [["all", "Alle"]] : []), ["closed", "Afgerond / geannuleerd"]].map(([key, label]) => <button class="btn btn-light" type="button" key={key} aria-pressed={view === key} onClick={() => { setView(key); setSelected(null); }}>{label}</button>)}</div>
        <details class="task-filter-panel" open={filtersOpen} onToggle={e => setFiltersOpen(e.currentTarget.open)}><summary>Zoeken en filteren</summary>
        <div class="task-fields task-filters"><label>Zoeken<input type="search" value={search} onInput={e => setSearch(e.currentTarget.value)} /></label>
          <label>Filter op status<select aria-label="Filter op status" value={status} disabled={view === "closed"} onChange={e => setStatus(e.currentTarget.value)}><option value="active">Actief</option><option value="">Alle</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Filter op prioriteit<select aria-label="Filter op prioriteit" value={priority} onChange={e => setPriority(e.currentTarget.value)}><option value="">Alle</option>{Object.entries(priorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Filter op deadline<select aria-label="Filter op deadline" value={deadline} onChange={e => setDeadline(e.currentTarget.value)}><option value="">Alle</option><option value="overdue">Te laat</option><option value="today">Vandaag</option><option value="none">Zonder deadline</option></select></label>
          <label>Filter op activiteit<select aria-label="Filter op activiteit" value={eventId} onChange={e => setEventId(e.currentTarget.value)}><option value="">Alle</option>{data.events.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>
        </div></details>
        <button class="btn btn-light" type="button" disabled={loading || busy} onClick={() => { setSelected(null); void reload(); }}>Taken verversen</button>
        {loading ? <p role="status">Taken laden…</p> : !error && <>
          {!visible.length && <p>Geen taken in deze weergave. Pas je filters aan of maak een taak aan.</p>}
          <ul class="task-list">{visible.map(task => <TaskCard key={task.id} task={task} data={data} access={access} busy={busy} onSelect={open} onWork={work} />)}</ul>
        </>}
      </>}
  </section>;
}
