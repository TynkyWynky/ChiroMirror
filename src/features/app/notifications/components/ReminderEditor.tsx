import { useState } from "preact/hooks";
import { instantToLocal, localToInstant, MAX_DATE, MIN_DATE } from "../../events/dates";
import { localReminder, offsetReminder } from "../reminders";
import type { Reminder } from "../types";
import "../notifications.css";
export default function ReminderEditor({ value, onChange, recurring = false }: { value: Reminder[]; onChange: (value: Reminder[]) => void; recurring?: boolean }) {
  const [error, setError] = useState("");
  const change = (index: number, patch: Partial<Reminder>) => onChange(value.map((r, i) => i === index ? { ...r, ...patch } : r));
  return <section class="reminder-editor" aria-label="Rappels"><h3>Rappels</h3><p>Heure de Bruxelles. Les préférences de chaque destinataire restent prioritaires.</p>
    {error && <p role="alert">{error}</p>}
    {!value.length && <p>Aucun rappel.</p>}
    {value.map((reminder, i) => <div class="reminder-row" key={reminder.id ?? i}>
      <label>Rappel {i + 1}<select aria-label={`Type du rappel ${i + 1}`} value={reminder.kind} onChange={e => {
        const kind = e.currentTarget.value; const next = kind === "LOCAL_TIME" ? localReminder() : kind === "OFFSET" ? offsetReminder() : { kind: "ABSOLUTE" as const, days_before: null, local_time: null, offset_minutes: null, scheduled_at: null };
        change(i, next);
      }}><option value="LOCAL_TIME">Jours avant, à une heure locale</option><option value="OFFSET">Délai avant l’échéance ou le début</option><option value="ABSOLUTE" disabled={recurring}>Date et heure personnalisées</option></select></label>
      {reminder.kind === "LOCAL_TIME" && <><label>Jours avant<input type="number" min={0} max={365} required value={reminder.days_before ?? ""} onInput={e => change(i, { days_before: Number(e.currentTarget.value) })} /></label><label>Heure locale<input type="time" required value={reminder.local_time?.slice(0,5) ?? ""} onInput={e => change(i, { local_time: e.currentTarget.value })} /></label></>}
      {reminder.kind === "OFFSET" && <label>Minutes avant<input type="number" min={0} max={525600} required value={reminder.offset_minutes ?? ""} onInput={e => change(i, { offset_minutes: Number(e.currentTarget.value) })} /><span>120 = 2 heures ; 1440 = 24 heures écoulées.</span></label>}
      {reminder.kind === "ABSOLUTE" && <label>Date et heure du rappel<input type="datetime-local" required min={`${MIN_DATE}T00:00`} max={`${MAX_DATE}T23:59`} value={reminder.scheduled_at ? instantToLocal(reminder.scheduled_at) : ""} onChange={e => {
        setError(""); try { change(i, { scheduled_at: e.currentTarget.value ? localToInstant(e.currentTarget.value) : null }); } catch { change(i, { scheduled_at: null }); setError("Cette heure locale est ambiguë ou inexistante. Choisissez une autre heure."); }
      }} /></label>}
      <button class="btn btn-light" type="button" onClick={() => onChange(value.filter((_, index) => index !== i))}>Retirer le rappel {i + 1}</button>
    </div>)}
    <div class="notification-actions"><button class="btn btn-light" type="button" disabled={value.length >= 10} onClick={() => onChange([...value, localReminder()])}>+ 1 jour avant à 19:00</button><button class="btn btn-light" type="button" disabled={value.length >= 10} onClick={() => onChange([...value, localReminder(7)])}>+ 1 semaine avant</button><button class="btn btn-light" type="button" disabled={value.length >= 10} onClick={() => onChange([...value, offsetReminder()])}>+ 2 heures avant</button></div>
    {recurring && <p>Ces rappels s’appliquent à chaque occurrence, en suivant ses déplacements. Les dates absolues sont réservées aux événements simples et aux tâches.</p>}
  </section>;
}
