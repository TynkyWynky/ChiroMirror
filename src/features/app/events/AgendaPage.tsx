import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasAppPermission } from "../access";
import type { AppAccess } from "../types";
import { agendaError, cancelEvent, emptyAgenda, loadAgenda, saveEvent, type AgendaData } from "./data";
import { addDays, formatMonth, MAX_DATE, MIN_DATE, monthDays, monthStart, shiftMonth, startDay, today } from "./dates";
import { expandEvents } from "./recurrence";
import type { CalendarEvent, EventDraft, EventInput, EventOccurrence } from "./types";
import { makeDraft } from "./validation";
import EventForm from "./components/EventForm";
import EventDetail from "./components/EventDetail";
import { ListView, MonthView } from "./components/CalendarViews";
import "./agenda.css";

interface Editing { event: CalendarEvent | null; occurrenceDate?: string; draft: EventDraft }
export default function AgendaPage({ client, access, openTarget, onTargetHandled, onResourceOpen, onResourceClose }: { client: SupabaseClient; access: AppAccess; openTarget?: { id: string; occurrence?: string }; onTargetHandled?: () => void; onResourceOpen?: (id:string,occurrence:string)=>void; onResourceClose?: ()=>void }) {
  const [data, setData] = useState<AgendaData>(emptyAgenda);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [feedback, setFeedback] = useState("");
  const [month, setMonth] = useState(() => monthStart(today()));
  const [view, setView] = useState<"month" | "list">("list");
  const [category, setCategory] = useState(""), [showCancelled, setShowCancelled] = useState(false);
  const [selected, setSelected] = useState<EventOccurrence | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const requestId = useRef(0), returnFocus = useRef<HTMLElement | null>(null);
  const canCreate = hasAppPermission(access.permissions, "events.create");
  const canUpdate = hasAppPermission(access.permissions, "events.update");
  const canCancel = hasAppPermission(access.permissions, "events.delete");
  const days = useMemo(() => monthDays(month), [month]);
  const from = view === "month" ? days[0] : month, to = view === "month" ? days[41] : addDays(shiftMonth(month, 1), -1);
  const occurrences = useMemo(() => expandEvents(data.events, data.overrides, from, to)
    .filter(occurrence => (!category || occurrence.category === category) && (showCancelled || occurrence.status !== "CANCELLED")), [data, from, to, category, showCancelled]);

  async function reload() {
    const id = ++requestId.current;
    setLoading(true); setError("");
    try { const next = await loadAgenda(client); if (id === requestId.current) setData(next); }
    catch (cause) { if (id === requestId.current) { setData(emptyAgenda); setError(agendaError(cause)); } }
    finally { if (id === requestId.current) setLoading(false); }
  }
  useEffect(() => { if (window.matchMedia("(min-width: 900px)").matches) setView("month"); }, []);
  useEffect(() => { void reload(); return () => { requestId.current++; }; }, [client, access]);
  useEffect(() => {
    if (loading) return;
    if (!openTarget) { if(onResourceClose){setSelected(null);setEditing(null);} return; }
    const event = data.events.find(e => e.id === openTarget.id);
    const date = openTarget.occurrence ?? (event ? startDay(event) : today());
    const override = data.overrides.find(o => o.event_id === openTarget.id && o.occurrence_date === date);
    const day = override ? startDay(override) : date;
    const found = event && expandEvents([event], data.overrides.filter(o => o.event_id === event.id), day, day).find(o => o.occurrence_date === date);
    if (found) { setMonth(monthStart(day)); setSelected(found); } else setError("Cet événement ou cette occurrence n’est plus accessible.");
    onTargetHandled?.();
  }, [loading, openTarget?.id, openTarget?.occurrence, data]);
  function close() {
    onResourceClose?.();
    setEditing(null); setSelected(null); setError("");
    requestAnimationFrame(() => returnFocus.current?.isConnected && returnFocus.current.focus());
  }
  function select(occurrence: EventOccurrence) {
    onResourceOpen?.(occurrence.event.id,occurrence.occurrence_date);
    returnFocus.current = document.activeElement as HTMLElement;
    setSelected(occurrence); setEditing(null); setError(""); setFeedback("");
  }
  function create() {
    returnFocus.current = document.activeElement as HTMLElement;
    setSelected(null); setError(""); setFeedback("");
    setEditing({ event: null, draft: makeDraft(undefined, [], month === monthStart(today()) ? today() : month) });
  }
  async function mutate(action: () => Promise<void>, message: string) {
    if (busy) return;
    setBusy(true); setError(""); setFeedback("");
    try {
      await action(); setEditing(null); setSelected(null); setFeedback(message); await reload();
      requestAnimationFrame(() => returnFocus.current?.isConnected && returnFocus.current.focus());
    }
    catch (cause) { setError(agendaError(cause)); }
    finally { setBusy(false); }
  }
  async function submit(input: EventInput) {
    if (!editing) return;
    await mutate(() => saveEvent(client, editing.event, input, editing.occurrenceDate), "Événement enregistré.");
  }
  return <section class="admin-panel agenda" lang="fr" aria-busy={loading || busy}>
    <header class="admin-page-heading"><div><p class="admin-eyebrow">APP</p><h1>Agenda</h1><p>Activités, réunions et moments de la Chiro.</p></div>
      {canCreate && <button class="btn" type="button" disabled={loading || busy || Boolean(editing)} onClick={create}>+ Nouvel événement</button>}
    </header>
    {feedback && <p role="status" class="agenda-feedback">{feedback}</p>}
    {error && !editing && <p class="agenda-error" role="alert">{error} <button class="btn btn-light" type="button" disabled={busy} onClick={() => { setSelected(null); void reload(); }}>Réessayer</button></p>}
    {editing ? <EventForm initial={editing.draft} initialReminders={editing.event ? data.reminders.filter(r => r.event_id === editing.event!.id) : undefined} categories={data.categories} members={data.members} occurrenceOnly={Boolean(editing.occurrenceDate)} editing={Boolean(editing.event)} busy={busy} error={error} onSave={submit} onClose={close} />
      : selected ? <EventDetail occurrence={selected} data={data} canUpdate={canUpdate} canCancel={canCancel} busy={busy} onClose={close}
        onEdit={occurrenceOnly => {
          const ids = data.participants.filter(item => item.event_id === selected.event.id).map(item => item.member_id);
          setEditing({ event: selected.event, occurrenceDate: occurrenceOnly ? selected.occurrence_date : undefined, draft: makeDraft(occurrenceOnly ? selected : selected.event, ids) });
        }} onCancel={occurrenceOnly => {
          const scope = occurrenceOnly ? "uniquement cette occurrence" : selected.event.frequency !== "NONE" ? "toute la série, y compris ses exceptions" : "cet événement";
          if (window.confirm(`Annuler ${scope} ? L’historique sera conservé.`)) void mutate(() => cancelEvent(client, selected.event, occurrenceOnly ? selected.occurrence_date : null), "Annulation enregistrée.");
        }} /> : <>
        <div class="agenda-toolbar">
          <div class="agenda-actions"><button class="btn btn-light" type="button" disabled={month <= monthStart(MIN_DATE)} aria-label="Mois précédent" onClick={() => setMonth(shiftMonth(month, -1))}>←</button>
            <h2 aria-live="polite">{formatMonth(month)}</h2><button class="btn btn-light" type="button" disabled={month >= monthStart(MAX_DATE)} aria-label="Mois suivant" onClick={() => setMonth(shiftMonth(month, 1))}>→</button>
            <button class="btn btn-light" type="button" onClick={() => setMonth(monthStart(today()))}>Aujourd’hui</button></div>
          <div class="agenda-actions" role="group" aria-label="Vue de l’agenda"><button type="button" class="btn btn-light" aria-pressed={view === "month"} onClick={() => setView("month")}>Mois</button><button type="button" class="btn btn-light" aria-pressed={view === "list"} onClick={() => setView("list")}>Liste</button></div>
        </div>
        <div class="agenda-fields agenda-filters"><label>Type d’événement<select value={category} onChange={e => setCategory(e.currentTarget.value)}><option value="">Tous les types</option>{data.categories.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <label class="agenda-check"><input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.currentTarget.checked)} />Afficher les événements annulés</label>
          <button class="btn btn-light" disabled={loading || busy} type="button" onClick={() => void reload()}>Actualiser</button>
        </div>
        {loading ? <p role="status">Chargement de l’agenda…</p> : !error && <>
          {!occurrences.length && <div class="admin-subpanel"><p>Aucun événement prévu.</p>{canCreate && <button class="btn" type="button" onClick={create}>Créer le premier événement</button>}</div>}
          {view === "month" ? <MonthView days={days} month={month} occurrences={occurrences} categories={data.categories} onSelect={select} />
            : <ListView from={from} occurrences={occurrences} categories={data.categories} onSelect={select} />}
        </>}
      </>}
  </section>;
}
