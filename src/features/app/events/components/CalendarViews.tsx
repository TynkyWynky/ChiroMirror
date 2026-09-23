import { endDay, formatDay, formatTime, formatTiming, overlaps, startDay, today, weekdays } from "../dates";
import type { EventCategory, EventOccurrence } from "../types";

interface Props { occurrences: EventOccurrence[]; categories: EventCategory[]; onSelect: (event: EventOccurrence) => void }
export function EventButton({ occurrence, categories, onSelect, day }: { occurrence: EventOccurrence; day?: string } & Pick<Props, "categories" | "onSelect">) {
  const label = categories.find(category => category.key === occurrence.category)?.label ?? occurrence.category;
  const timeLabel = occurrence.all_day ? "Toute la journée"
    : day && day > startDay(occurrence) ? day === endDay(occurrence) ? `Fin à ${formatTime(occurrence.ends_at!)}` : "En cours"
    : `${formatTime(occurrence.starts_at!)}${startDay(occurrence) !== endDay(occurrence) ? " →" : ""}`;
  return <button type="button" class={`agenda-event category-${occurrence.category.toLowerCase()} ${occurrence.status === "CANCELLED" ? "is-cancelled" : ""}`} onClick={() => onSelect(occurrence)}>
    <span class="agenda-event-kind">{label}{occurrence.status === "CANCELLED" ? " · Annulé" : ""}</span>
    <strong>{occurrence.title}</strong>
    <span>{day && day > startDay(occurrence) && occurrence.all_day ? "Suite · " : ""}{timeLabel}</span>
  </button>;
}
export function MonthView({ days, month, ...props }: Props & { days: string[]; month: string }) {
  return <div class="agenda-month-wrap"><table class="agenda-month"><caption class="agenda-sr-only">Calendrier mensuel. Chaque événement ouvre sa fiche.</caption><thead><tr>{weekdays.map(day => <th scope="col" key={day}><abbr title={day}>{day.slice(0, 3)}</abbr></th>)}</tr></thead>
    <tbody>{Array.from({ length: 6 }, (_, week) => <tr key={week}>{days.slice(week * 7, week * 7 + 7).map(date => <td key={date} class={`${date.slice(0, 7) !== month.slice(0, 7) ? "outside-month" : ""} ${date === today() ? "is-today" : ""}`}>
      <time dateTime={date} aria-label={formatDay(date)}>{Number(date.slice(-2))}{date === today() ? " · Aujourd’hui" : ""}</time>
      {props.occurrences.filter(occurrence => overlaps(occurrence, date, date)).map(occurrence => <EventButton key={`${occurrence.event.id}/${occurrence.occurrence_date}`} occurrence={occurrence} day={date} categories={props.categories} onSelect={props.onSelect} />)}
    </td>)}</tr>)}</tbody></table></div>;
}
export function ListView({ occurrences, categories, onSelect, from }: Props & { from: string }) {
  const groups = new Map<string, EventOccurrence[]>();
  for (const occurrence of occurrences) {
    const date = startDay(occurrence) < from ? from : startDay(occurrence);
    groups.set(date, [...(groups.get(date) ?? []), occurrence]);
  }
  return <div class="agenda-list">{[...groups].map(([date, items]) => <section key={date}>
    <h2>{date === today() ? "Aujourd’hui" : formatDay(date)}</h2>
    <ul>{items.map(occurrence => <li key={`${occurrence.event.id}/${occurrence.occurrence_date}`}><EventButton occurrence={occurrence} categories={categories} onSelect={onSelect} />
      <p>{formatTiming(occurrence)}</p>{occurrence.location && <p>Lieu : {occurrence.location}</p>}
      <p>{occurrence.event.audience_type === "ALL" ? "Toute la Chiro" : "Membres sélectionnés"}</p>
    </li>)}</ul>
  </section>)}</div>;
}
