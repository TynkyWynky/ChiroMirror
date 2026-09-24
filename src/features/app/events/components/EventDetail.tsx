import { useEffect, useRef, useState } from "preact/hooks";
import type { AgendaData } from "../data";
import { formatDay, formatTiming } from "../dates";
import { recurrenceLabel } from "../recurrence";
import type { EventOccurrence } from "../types";

interface Props {
  occurrence: EventOccurrence; data: AgendaData; canUpdate: boolean; canCancel: boolean; busy: boolean;
  onClose: () => void; onEdit: (occurrenceOnly: boolean) => void; onCancel: (occurrenceOnly: boolean) => void;
}
export default function EventDetail({ occurrence, data, canUpdate, canCancel, busy, onClose, onEdit, onCancel }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [scope, setScope] = useState("occurrence");
  useEffect(() => { heading.current?.focus(); }, []);
  const series = occurrence.event.frequency !== "NONE", cancelled = occurrence.status === "CANCELLED";
  const participantIds = data.participants.filter(item => item.event_id === occurrence.event.id).map(item => item.member_id);
  const creator = data.members.find(member => member.user_id === occurrence.event.created_by);
  return <section class="admin-subpanel agenda-detail" aria-label="Activiteitdetails">
    <h2 ref={heading} tabIndex={-1}>{occurrence.title}</h2>
    <p>{data.categories.find(category => category.key === occurrence.category)?.label} {cancelled ? "· Geannuleerd" : ""}</p>
    <p>{formatTiming(occurrence)}</p>
    {occurrence.location && <p><strong>Locatie:</strong> {occurrence.location}</p>}
    {occurrence.description && <p class="agenda-description">{occurrence.description}</p>}
    <h3>Betrokken personen</h3>
    {occurrence.event.audience_type === "ALL" ? <p>De hele Chiro</p> : <ul>{participantIds.map(id => {
      const member = data.members.find(item => item.id === id);
      return <li key={id}>{member ? `${member.first_name} ${member.last_name}${member.active ? "" : " (gearchiveerd)"}` : "Lid niet zichtbaar"}</li>;
    })}</ul>}
    <p>{recurrenceLabel(occurrence.event)}</p>
    {occurrence.overridden && <p>Uitzondering op het exemplaar van {formatDay(occurrence.occurrence_date)}.</p>}
    {creator && <p>Aangemaakt door {creator.first_name} {creator.last_name}.</p>}
    {series && !cancelled && (canUpdate || canCancel) && <label>Bereik van de actie<select aria-label="Bereik van de actie" value={scope} onChange={e => setScope(e.currentTarget.value)}><option value="occurrence">Alleen dit exemplaar</option><option value="series">De hele reeks</option></select></label>}
    <div class="agenda-actions">
      {!cancelled && canUpdate && <button type="button" class="btn" disabled={busy} onClick={() => onEdit(series && scope === "occurrence")}>{series ? scope === "occurrence" ? "Dit exemplaar bewerken" : "De hele reeks bewerken" : "Bewerken"}</button>}
      {!cancelled && canCancel && <button type="button" class="btn btn-light" disabled={busy} onClick={() => onCancel(series && scope === "occurrence")}>{series ? scope === "occurrence" ? "Dit exemplaar annuleren" : "De hele reeks annuleren" : "Activiteit annuleren"}</button>}
      <button type="button" class="btn btn-light" disabled={busy} onClick={onClose}>Details sluiten</button>
    </div>
  </section>;
}
