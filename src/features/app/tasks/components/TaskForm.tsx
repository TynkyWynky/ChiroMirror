import { useEffect, useRef, useState } from "preact/hooks";
import type { TasksData } from "../data";
import { MAX_DATE, MIN_DATE } from "../../events/dates";
import { makeTaskDraft, validateTask } from "../validation";
import ReminderEditor from "../../notifications/components/ReminderEditor";
import { localReminder, offsetReminder, validateReminders } from "../../notifications/reminders";
import type { Reminder } from "../../notifications/types";
import { priorityLabels, roleLabels, statusLabels, type Task, type TaskAssignment, type TaskDraft, type TaskInput, type TaskScope } from "../types";

interface Props { task: Task | null; scope: TaskScope; data: TasksData; busy: boolean; error: string; canComplete: boolean;
  onSave: (details: TaskInput, assignments: TaskAssignment[]) => Promise<void>; onClose: () => void }
export default function TaskForm({ task, scope, data, busy, error, canComplete, onSave, onClose }: Props) {
  const original = data.assignments.filter(item => item.task_id === task?.id);
  const [draft, setDraft] = useState(() => makeTaskDraft(scope, task ?? undefined, original.map(({ member_id, role }) => ({ member_id, role }))));
  const [validationError, setValidationError] = useState("");
  const [customReminders, setCustomReminders] = useState<Reminder[] | null>(task ? data.reminders.filter(r => r.task_id === task.id) : null);
  const reminders = customReminders ?? (draft.deadline_kind === "DATE" ? [localReminder()] : draft.deadline_kind === "TIMED" ? [offsetReminder(1440)] : []);
  const title = useRef<HTMLInputElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const change = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const selectedEvent = data.events.find(event => event.id === draft.event_id);
  return <form class="admin-subpanel task-form" onSubmit={event => {
    event.preventDefault(); setValidationError("");
    try {
      const result = validateTask(draft, data.members, data.events, task ?? undefined, original);
      result.details.reminders = draft.deadline_kind === "NONE" ? [] : validateReminders(reminders);
      if (draft.status === "DONE" && task?.status !== "DONE" && scope === "TEAM") {
        const pending = draft.assignments.filter(member => original.find(item => item.member_id === member.member_id)?.work_status !== "DONE").length;
        if (pending && !window.confirm(`${pending} personne(s) n’ont pas encore terminé leur partie. Marquer quand même la tâche comme terminée ?`)) return;
      }
      if (draft.status === "CANCELLED" && task?.status !== "CANCELLED" && !window.confirm("Annuler cette tâche ? Son historique sera conservé.")) return;
      void onSave(result.details, result.assignments);
    } catch (cause) { setValidationError(cause instanceof Error ? cause.message : "Vérifiez les champs."); }
  }}>
    <h2>{task ? "Modifier la tâche" : scope === "PERSONAL" ? "Nouvelle tâche personnelle" : "Nouvelle tâche d’équipe"}</h2>
    {scope === "PERSONAL" && <p>Privée : seuls votre compte et votre membre lié peuvent la consulter.</p>}
    {(validationError || error) && <p role="alert" class="task-error">{validationError || error}</p>}
    <fieldset disabled={busy}>
      <label>Titre *<input ref={title} required maxLength={200} value={draft.title} onInput={e => change("title", e.currentTarget.value)} /></label>
      <label>Description<textarea rows={4} maxLength={10000} value={draft.description} onInput={e => change("description", e.currentTarget.value)} /></label>
      <div class="task-fields"><label>Priorité<select aria-label="Priorité" value={draft.priority} onChange={e => change("priority", e.currentTarget.value as TaskDraft["priority"])}>{Object.entries(priorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Statut<select aria-label="Statut" value={draft.status} onChange={e => change("status", e.currentTarget.value as TaskDraft["status"])}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key} disabled={key === "DONE" && !canComplete && task?.status !== "DONE"}>{label}</option>)}</select></label></div>
      {!canComplete && scope === "TEAM" && <p>Seuls les responsables de la tâche et les gestionnaires globaux peuvent la terminer.</p>}
      <div class="task-fields"><label>Échéance<select aria-label="Échéance" value={draft.deadline_kind} onChange={e => {
        const deadline_kind = e.currentTarget.value as TaskDraft["deadline_kind"];
        setDraft(current => ({ ...current, deadline_kind, deadline: deadline_kind === "NONE" ? "" : current.deadline ? current.deadline.slice(0, 10) + (deadline_kind === "TIMED" ? "T19:00" : "") : "" }));
      }}><option value="NONE">Aucune</option><option value="DATE">Date seule</option><option value="TIMED">Date et heure</option></select></label>
        {draft.deadline_kind !== "NONE" && <label>{draft.deadline_kind === "DATE" ? "Date limite *" : "Date et heure limite *"}<input required type={draft.deadline_kind === "DATE" ? "date" : "datetime-local"} min={MIN_DATE + (draft.deadline_kind === "TIMED" ? "T00:00" : "")} max={MAX_DATE + (draft.deadline_kind === "TIMED" ? "T23:59" : "")} value={draft.deadline} onInput={e => change("deadline", e.currentTarget.value)} /></label>}
      </div>
      {draft.deadline_kind !== "NONE" && <p class="muted">{draft.deadline_kind === "DATE" ? "La journée entière est incluse." : "Heure de Bruxelles. Les heures ambiguës ou inexistantes du changement d’heure sont refusées."}</p>}
      {scope === "TEAM" && <>
        <label>Événement lié<select aria-label="Événement lié" value={draft.event_id} onChange={e => setDraft(current => ({ ...current, event_id: e.currentTarget.value, event_occurrence_date: "" }))}>
          <option value="">Aucun événement</option>{draft.event_id && !selectedEvent && <option value={draft.event_id}>Événement lié non consultable</option>}
          {data.events.map(event => <option key={event.id} value={event.id}>{event.title}{event.frequency !== "NONE" ? " (série)" : ""}{event.status === "CANCELLED" ? " — annulé" : ""}</option>)}
        </select></label>
        {(selectedEvent?.frequency !== "NONE" && selectedEvent || draft.event_occurrence_date) && <label>Date d’origine de l’occurrence (facultative)<input type="date" min={MIN_DATE} max={MAX_DATE} value={draft.event_occurrence_date} onInput={e => change("event_occurrence_date", e.currentTarget.value)} /><span class="muted">Laisser vide pour lier toute la série. Après un déplacement, conserver la date d’origine.</span></label>}
        <fieldset class="task-assignment-picker"><legend>Responsables et participants — au moins un responsable</legend>
          {data.members.filter(member => member.active || original.some(item => item.member_id === member.id)).map(member => <label key={member.id} class="task-assignment-row">
            <span>{member.first_name} {member.last_name}{member.active ? "" : " (archivé)"}</span>
            <select aria-label={`Rôle de ${member.first_name} ${member.last_name}`} value={draft.assignments.find(item => item.member_id === member.id)?.role ?? ""} onChange={e => {
              const role = e.currentTarget.value as TaskAssignment["role"] | "";
              change("assignments", [...draft.assignments.filter(item => item.member_id !== member.id), ...(role ? [{ member_id: member.id, role }] : [])]);
            }}><option value="">Non affecté</option>{Object.entries(roleLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          </label>)}
        </fieldset>
      </>}
      {draft.deadline_kind !== "NONE" && <ReminderEditor value={reminders} onChange={setCustomReminders} />}
      <div class="task-actions"><button class="btn" type="submit">{busy ? "Enregistrement…" : "Enregistrer"}</button><button class="btn btn-light" type="button" onClick={onClose}>Fermer sans enregistrer</button></div>
    </fieldset>
  </form>;
}
