import { useState } from "preact/hooks";
import { instantToLocal, localToInstant, MAX_DATE, MIN_DATE } from "../../events/dates";
import { localReminder, offsetReminder } from "../reminders";
import type { Reminder } from "../types";
import "../notifications.css";
export default function ReminderEditor({ value, onChange, recurring = false }: { value: Reminder[]; onChange: (value: Reminder[]) => void; recurring?: boolean }) {
  const [error, setError] = useState("");
  const change = (index: number, patch: Partial<Reminder>) => onChange(value.map((r, i) => i === index ? { ...r, ...patch } : r));
  return <section class="reminder-editor" aria-label="Herinneringen"><h3>Herinneringen</h3><p>Tijd in Brussel. De voorkeuren van elke ontvanger hebben voorrang.</p>
    {error && <p role="alert">{error}</p>}
    {!value.length && <p>Geen herinneringen.</p>}
    {value.map((reminder, i) => <div class="reminder-row" key={reminder.id ?? i}>
      <label>Herinnering {i + 1}<select aria-label={`Type herinnering ${i + 1}`} value={reminder.kind} onChange={e => {
        const kind = e.currentTarget.value; const next = kind === "LOCAL_TIME" ? localReminder() : kind === "OFFSET" ? offsetReminder() : { kind: "ABSOLUTE" as const, days_before: null, local_time: null, offset_minutes: null, scheduled_at: null };
        change(i, next);
      }}><option value="LOCAL_TIME">Dagen vooraf, op een lokaal tijdstip</option><option value="OFFSET">Tijd vóór de deadline of het begin</option><option value="ABSOLUTE" disabled={recurring}>Aangepaste datum en tijd</option></select></label>
      {reminder.kind === "LOCAL_TIME" && <><label>Dagen vooraf<input type="number" min={0} max={365} required value={reminder.days_before ?? ""} onInput={e => change(i, { days_before: Number(e.currentTarget.value) })} /></label><label>Lokale tijd<input type="time" required value={reminder.local_time?.slice(0,5) ?? ""} onInput={e => change(i, { local_time: e.currentTarget.value })} /></label></>}
      {reminder.kind === "OFFSET" && <label>Minuten vooraf<input type="number" min={0} max={525600} required value={reminder.offset_minutes ?? ""} onInput={e => change(i, { offset_minutes: Number(e.currentTarget.value) })} /><span>120 = 2 uur; 1440 = 24 verstreken uren.</span></label>}
      {reminder.kind === "ABSOLUTE" && <label>Datum en tijd van de herinnering<input type="datetime-local" required min={`${MIN_DATE}T00:00`} max={`${MAX_DATE}T23:59`} value={reminder.scheduled_at ? instantToLocal(reminder.scheduled_at) : ""} onChange={e => {
        setError(""); try { change(i, { scheduled_at: e.currentTarget.value ? localToInstant(e.currentTarget.value) : null }); } catch { change(i, { scheduled_at: null }); setError("Dit lokale tijdstip is dubbelzinnig of bestaat niet. Kies een andere tijd."); }
      }} /></label>}
      <button class="btn btn-light" type="button" onClick={() => onChange(value.filter((_, index) => index !== i))}>Herinnering verwijderen {i + 1}</button>
    </div>)}
    <div class="notification-actions"><button class="btn btn-light" type="button" disabled={value.length >= 10} onClick={() => onChange([...value, localReminder()])}>+ 1 dag vooraf om 19:00</button><button class="btn btn-light" type="button" disabled={value.length >= 10} onClick={() => onChange([...value, localReminder(7)])}>+ 1 week vooraf</button><button class="btn btn-light" type="button" disabled={value.length >= 10} onClick={() => onChange([...value, offsetReminder()])}>+ 2 uur vooraf</button></div>
    {recurring && <p>Deze herinneringen gelden voor elk exemplaar en volgen verplaatsingen. Vaste datums zijn voorbehouden aan losse activiteiten en taken.</p>}
  </section>;
}
