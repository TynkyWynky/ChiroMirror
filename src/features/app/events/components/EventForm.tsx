import { useEffect, useRef, useState } from "preact/hooks";
import type { Member } from "../../types";
import { civil, MAX_DATE, MIN_DATE, weekdays } from "../dates";
import type { EventCategory, EventDraft, EventInput } from "../types";
import { validateEvent } from "../validation";
import ReminderEditor from "../../notifications/components/ReminderEditor";
import { defaultEventReminders, validateReminders } from "../../notifications/reminders";
import type { Reminder } from "../../notifications/types";

interface Props {
  initial: EventDraft; categories: EventCategory[]; members: Member[];
  initialReminders?: Reminder[];
  occurrenceOnly: boolean; editing: boolean; busy: boolean; error: string;
  onSave: (input: EventInput) => Promise<void>; onClose: () => void;
}
export default function EventForm({ initial, initialReminders, categories, members, occurrenceOnly, editing, busy, error, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(initial), [validationError, setValidationError] = useState("");
  const [customReminders, setCustomReminders] = useState<Reminder[] | null>(initialReminders ?? null);
  const reminders = customReminders ?? defaultEventReminders(draft.category);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  const change = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  function startWeekday(value: string): number[] {
    try { return [civil(value.slice(0, 10)).dayOfWeek]; } catch { return []; }
  }
  const displayedMembers = members.filter(member => member.active || initial.participant_ids.includes(member.id));
  const heading = occurrenceOnly ? "Modifier cette occurrence" : editing ? "Modifier l’événement / la série" : "Nouvel événement";
  return <form class="agenda-form admin-subpanel" onSubmit={event => {
    event.preventDefault(); setValidationError("");
    try { const input = validateEvent(occurrenceOnly ? { ...draft, frequency: "NONE", recurrence_interval: 1 } : draft, categories); if (!occurrenceOnly) input.reminders = validateReminders(reminders, draft.frequency !== "NONE"); void onSave(input); }
    catch (cause) { setValidationError(cause instanceof Error ? cause.message : "Vérifiez les champs."); }
  }}>
    <h2>{heading}</h2>
    {(validationError || error) && <p class="agenda-error" role="alert">{validationError || error}</p>}
    <fieldset disabled={busy}>
      <label>Titre *<input ref={titleRef} required maxLength={200} value={draft.title} onInput={e => change("title", e.currentTarget.value)} /></label>
      <div class="agenda-fields">
        <label>Type *<select required value={draft.category} onChange={e => change("category", e.currentTarget.value)}>{categories.map(category => <option value={category.key} key={category.key}>{category.label}</option>)}</select></label>
        <label class="agenda-check"><input type="checkbox" checked={draft.all_day} onChange={e => {
          const all_day = e.currentTarget.checked;
          setDraft(current => ({ ...current, all_day, start: current.start.slice(0, 10) + (all_day ? "" : "T14:00"), end: current.end.slice(0, 10) + (all_day ? "" : "T18:00") }));
        }} />Toute la journée</label>
      </div>
      <div class="agenda-fields">
        <label>Début *<input required type={draft.all_day ? "date" : "datetime-local"} min={MIN_DATE + (draft.all_day ? "" : "T00:00")} max={MAX_DATE + (draft.all_day ? "" : "T23:59")} value={draft.start} onInput={e => {
          const start = e.currentTarget.value;
          setDraft(current => ({ ...current, start, weekdays: current.frequency === "WEEKLY" ? [...new Set([...current.weekdays, ...startWeekday(start)])] : current.weekdays }));
        }} /></label>
        <label>Fin *<input required type={draft.all_day ? "date" : "datetime-local"} min={draft.start} max={MAX_DATE + (draft.all_day ? "" : "T23:59")} value={draft.end} onInput={e => change("end", e.currentTarget.value)} /></label>
      </div>
      <p class="muted">{draft.all_day ? "La date de fin est incluse." : "Heures locales de Bruxelles (Europe/Brussels). Les heures ambiguës du changement d’heure sont refusées à la saisie."}</p>
      <label>Lieu<input maxLength={300} value={draft.location} onInput={e => change("location", e.currentTarget.value)} /></label>
      <label>Description<textarea rows={4} maxLength={10000} value={draft.description} onInput={e => change("description", e.currentTarget.value)} /></label>
      {occurrenceOnly ? <p>Les personnes concernées et la répétition restent celles de la série.</p> : <>
        <label>Personnes concernées<select aria-label="Personnes concernées" value={draft.audience_type} onChange={e => change("audience_type", e.currentTarget.value as EventDraft["audience_type"])}><option value="ALL">Toute la Chiro</option><option value="SELECTED">Membres sélectionnés</option></select></label>
        {draft.audience_type === "SELECTED" && <fieldset class="agenda-members"><legend>Membres concernés</legend>
          {!displayedMembers.length && <p>Aucun membre actif disponible.</p>}
          {displayedMembers.map(member => <label class="agenda-check" key={member.id}><input type="checkbox" checked={draft.participant_ids.includes(member.id)} onChange={e => change("participant_ids", e.currentTarget.checked ? [...draft.participant_ids, member.id] : draft.participant_ids.filter(id => id !== member.id))} />{member.first_name} {member.last_name}{member.active ? "" : " (archivé)"}</label>)}
        </fieldset>}
        <label>Répéter<select value={draft.frequency} onChange={e => {
          const frequency = e.currentTarget.value as EventDraft["frequency"];
          setDraft(current => ({ ...current, frequency, weekdays: frequency === "WEEKLY" ? startWeekday(current.start) : current.weekdays }));
        }}><option value="NONE">Aucune répétition</option><option value="WEEKLY">Chaque semaine / toutes les X semaines</option><option value="MONTHLY">Chaque mois / tous les X mois</option></select></label>
        {draft.frequency !== "NONE" && <>
          <label>Tous les combien de {draft.frequency === "WEEKLY" ? "semaines" : "mois"} ?<input type="number" min={1} max={52} required value={draft.recurrence_interval} onInput={e => change("recurrence_interval", Number(e.currentTarget.value))} /></label>
          {draft.frequency === "WEEKLY" ? <fieldset><legend>Jours de la semaine</legend><div class="agenda-actions">{weekdays.map((day, i) => <label class="agenda-check" key={day}><input type="checkbox" checked={draft.weekdays.includes(i + 1)} onChange={e => change("weekdays", e.currentTarget.checked ? [...draft.weekdays, i + 1] : draft.weekdays.filter(n => n !== i + 1))} />{day}</label>)}</div></fieldset>
            : <p>Le même jour du mois. Les mois sans ce jour sont ignorés (par exemple le 31 février).</p>}
          <div class="agenda-fields"><label>Fin de répétition (facultative)<input type="date" min={draft.start.slice(0, 10)} max={MAX_DATE} value={draft.until_date} onInput={e => change("until_date", e.currentTarget.value)} /></label>
            <label>Nombre d’occurrences (facultatif)<input type="number" min={1} max={10000} value={draft.occurrence_count} onInput={e => change("occurrence_count", e.currentTarget.value)} /></label></div>
          <p class="muted">Si les deux limites sont renseignées, la première atteinte arrête la série. Les exceptions déjà enregistrées sont conservées lors d’une modification de série.</p>
        </>}
      </>}
      {!occurrenceOnly ? <ReminderEditor value={reminders} onChange={setCustomReminders} recurring={draft.frequency !== "NONE"} /> : <p>Les rappels de la série suivent les nouvelles dates de cette occurrence.</p>}
      <div class="agenda-actions"><button class="btn" type="submit">{busy ? "Enregistrement…" : "Enregistrer"}</button><button class="btn btn-light" type="button" onClick={onClose}>Fermer sans enregistrer</button></div>
    </fieldset>
  </form>;
}
