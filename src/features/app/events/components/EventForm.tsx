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
  const heading = occurrenceOnly ? "Dit exemplaar bewerken" : editing ? "Activiteit / reeks bewerken" : "Nieuwe activiteit";
  return <form class="agenda-form admin-subpanel" onSubmit={event => {
    event.preventDefault(); setValidationError("");
    try { const input = validateEvent(occurrenceOnly ? { ...draft, frequency: "NONE", recurrence_interval: 1 } : draft, categories); if (!occurrenceOnly) input.reminders = validateReminders(reminders, draft.frequency !== "NONE"); void onSave(input); }
    catch (cause) { setValidationError(cause instanceof Error ? cause.message : "Controleer de velden."); }
  }}>
    <h2>{heading}</h2>
    {(validationError || error) && <p class="agenda-error" role="alert">{validationError || error}</p>}
    <fieldset disabled={busy}>
      <label>Titel *<input ref={titleRef} required maxLength={200} value={draft.title} onInput={e => change("title", e.currentTarget.value)} /></label>
      <div class="agenda-fields">
        <label>Type *<select required value={draft.category} onChange={e => change("category", e.currentTarget.value)}>{categories.map(category => <option value={category.key} key={category.key}>{category.label}</option>)}</select></label>
        <label class="agenda-check"><input type="checkbox" checked={draft.all_day} onChange={e => {
          const all_day = e.currentTarget.checked;
          setDraft(current => ({ ...current, all_day, start: current.start.slice(0, 10) + (all_day ? "" : "T14:00"), end: current.end.slice(0, 10) + (all_day ? "" : "T18:00") }));
        }} />Hele dag</label>
      </div>
      <div class="agenda-fields">
        <label>Begin *<input required type={draft.all_day ? "date" : "datetime-local"} min={MIN_DATE + (draft.all_day ? "" : "T00:00")} max={MAX_DATE + (draft.all_day ? "" : "T23:59")} value={draft.start} onInput={e => {
          const start = e.currentTarget.value;
          setDraft(current => ({ ...current, start, weekdays: current.frequency === "WEEKLY" ? [...new Set([...current.weekdays, ...startWeekday(start)])] : current.weekdays }));
        }} /></label>
        <label>Einde *<input required type={draft.all_day ? "date" : "datetime-local"} min={draft.start} max={MAX_DATE + (draft.all_day ? "" : "T23:59")} value={draft.end} onInput={e => change("end", e.currentTarget.value)} /></label>
      </div>
      <p class="muted">{draft.all_day ? "De einddatum is inbegrepen." : "Lokale tijd in Brussel (Europe/Brussels). Dubbelzinnige tijden bij de uurwisseling worden geweigerd."}</p>
      <label>Locatie<input maxLength={300} value={draft.location} onInput={e => change("location", e.currentTarget.value)} /></label>
      <label>Beschrijving<textarea rows={4} maxLength={10000} value={draft.description} onInput={e => change("description", e.currentTarget.value)} /></label>
      {occurrenceOnly ? <p>De betrokken personen en herhaling blijven die van de reeks.</p> : <>
        <label>Betrokken personen<select aria-label="Betrokken personen" value={draft.audience_type} onChange={e => change("audience_type", e.currentTarget.value as EventDraft["audience_type"])}><option value="ALL">De hele Chiro</option><option value="SELECTED">Geselecteerde leden</option></select></label>
        {draft.audience_type === "SELECTED" && <fieldset class="agenda-members"><legend>Betrokken leden</legend>
          {!displayedMembers.length && <p>Geen actieve leden beschikbaar.</p>}
          {displayedMembers.map(member => <label class="agenda-check" key={member.id}><input type="checkbox" checked={draft.participant_ids.includes(member.id)} onChange={e => change("participant_ids", e.currentTarget.checked ? [...draft.participant_ids, member.id] : draft.participant_ids.filter(id => id !== member.id))} />{member.first_name} {member.last_name}{member.active ? "" : " (gearchiveerd)"}</label>)}
        </fieldset>}
        <label>Herhalen<select value={draft.frequency} onChange={e => {
          const frequency = e.currentTarget.value as EventDraft["frequency"];
          setDraft(current => ({ ...current, frequency, weekdays: frequency === "WEEKLY" ? startWeekday(current.start) : current.weekdays }));
        }}><option value="NONE">Geen herhaling</option><option value="WEEKLY">Elke week / om de X weken</option><option value="MONTHLY">Elke maand / om de X maanden</option></select></label>
        {draft.frequency !== "NONE" && <>
          <label>Om de hoeveel {draft.frequency === "WEEKLY" ? "weken" : "maanden"} ?<input type="number" min={1} max={52} required value={draft.recurrence_interval} onInput={e => change("recurrence_interval", Number(e.currentTarget.value))} /></label>
          {draft.frequency === "WEEKLY" ? <fieldset><legend>Weekdagen</legend><div class="agenda-actions">{weekdays.map((day, i) => <label class="agenda-check" key={day}><input type="checkbox" checked={draft.weekdays.includes(i + 1)} onChange={e => change("weekdays", e.currentTarget.checked ? [...draft.weekdays, i + 1] : draft.weekdays.filter(n => n !== i + 1))} />{day}</label>)}</div></fieldset>
            : <p>Op dezelfde dag van de maand. Maanden zonder die dag worden overgeslagen (bijvoorbeeld 31 februari).</p>}
          <div class="agenda-fields"><label>Einde herhaling (optioneel)<input type="date" min={draft.start.slice(0, 10)} max={MAX_DATE} value={draft.until_date} onInput={e => change("until_date", e.currentTarget.value)} /></label>
            <label>Aantal exemplaren (optioneel)<input type="number" min={1} max={10000} value={draft.occurrence_count} onInput={e => change("occurrence_count", e.currentTarget.value)} /></label></div>
          <p class="muted">Als beide grenzen zijn ingevuld, stopt de reeks bij de eerste bereikte grens. Bestaande uitzonderingen blijven behouden bij het wijzigen van de reeks.</p>
        </>}
      </>}
      {!occurrenceOnly ? <ReminderEditor value={reminders} onChange={setCustomReminders} recurring={draft.frequency !== "NONE"} /> : <p>De herinneringen van de reeks volgen de nieuwe datums van dit exemplaar.</p>}
      <div class="agenda-actions"><button class="btn" type="submit">{busy ? "Opslaan…" : "Opslaan"}</button><button class="btn btn-light" type="button" onClick={onClose}>Sluiten zonder op te slaan</button></div>
    </fieldset>
  </form>;
}
