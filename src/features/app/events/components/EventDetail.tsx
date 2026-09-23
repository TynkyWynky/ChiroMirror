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
  return <section class="admin-subpanel agenda-detail" aria-label="Fiche événement">
    <h2 ref={heading} tabIndex={-1}>{occurrence.title}</h2>
    <p>{data.categories.find(category => category.key === occurrence.category)?.label} {cancelled ? "· Annulé" : ""}</p>
    <p>{formatTiming(occurrence)}</p>
    {occurrence.location && <p><strong>Lieu :</strong> {occurrence.location}</p>}
    {occurrence.description && <p class="agenda-description">{occurrence.description}</p>}
    <h3>Personnes concernées</h3>
    {occurrence.event.audience_type === "ALL" ? <p>Toute la Chiro</p> : <ul>{participantIds.map(id => {
      const member = data.members.find(item => item.id === id);
      return <li key={id}>{member ? `${member.first_name} ${member.last_name}${member.active ? "" : " (archivé)"}` : "Membre non consultable"}</li>;
    })}</ul>}
    <p>{recurrenceLabel(occurrence.event)}</p>
    {occurrence.overridden && <p>Exception à l’occurrence du {formatDay(occurrence.occurrence_date)}.</p>}
    {creator && <p>Créé par {creator.first_name} {creator.last_name}.</p>}
    {series && !cancelled && (canUpdate || canCancel) && <label>Portée de l’action<select aria-label="Portée de l’action" value={scope} onChange={e => setScope(e.currentTarget.value)}><option value="occurrence">Cette occurrence uniquement</option><option value="series">Toute la série</option></select></label>}
    <div class="agenda-actions">
      {!cancelled && canUpdate && <button type="button" class="btn" disabled={busy} onClick={() => onEdit(series && scope === "occurrence")}>Modifier {series ? scope === "occurrence" ? "cette occurrence" : "toute la série" : ""}</button>}
      {!cancelled && canCancel && <button type="button" class="btn btn-light" disabled={busy} onClick={() => onCancel(series && scope === "occurrence")}>Annuler {series ? scope === "occurrence" ? "cette occurrence" : "toute la série" : "l’événement"}</button>}
      <button type="button" class="btn btn-light" disabled={busy} onClick={onClose}>Fermer la fiche</button>
    </div>
  </section>;
}
