import { useEffect, useState } from "preact/hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, formatDay, formatTime, startDay, today } from "./dates";
import { agendaError, loadAgenda } from "./data";
import { expandEvents } from "./recurrence";
import type { EventOccurrence } from "./types";
export default function AgendaSummary({ client, onOpen }: { client: SupabaseClient; onOpen: () => void }) {
  const [events, setEvents] = useState<EventOccurrence[] | null>(null), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setEvents(null); setError("");
    loadAgenda(client).then(data => {
      if (active) setEvents(expandEvents(data.events, data.overrides, today(), addDays(today(), 30))
        .filter(e => e.status !== "CANCELLED" && (e.all_day || !e.ends_at || Date.parse(e.ends_at) >= Date.now())).slice(0, 3));
    }).catch(cause => { if (active) setError(agendaError(cause)); });
    return () => { active = false; };
  }, [client, attempt]);
  return <section class="admin-subpanel" lang="fr"><h2>Prochains événements</h2>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setAttempt(n => n + 1)}>Réessayer</button></p> : events ? events.length ? <ul>{events.map(event => <li key={`${event.event.id}:${event.occurrence_date}`}><strong>{event.title}</strong> — {formatDay(startDay(event), false)}{event.starts_at ? ` à ${formatTime(event.starts_at)}` : " · toute la journée"}</li>)}</ul> : <p>Aucun événement prévu dans les 30 prochains jours.</p> : <p role="status">Chargement de l’agenda…</p>}
    <button class="btn btn-light" type="button" onClick={onOpen}>Ouvrir l’agenda</button>
  </section>;
}
