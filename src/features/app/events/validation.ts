import { Temporal } from "@js-temporal/polyfill";
import { civil, instantToLocal, localToInstant, startDay, today } from "./dates.ts";
import { EVENT_ZONE, type CalendarEvent, type EventCategory, type EventDraft, type EventInput, type EventOccurrence } from "./types.ts";

export function validateEvent(draft: EventDraft, categories: EventCategory[]): EventInput {
  const title = draft.title.trim(), description = draft.description.trim(), location = draft.location.trim();
  if (!title || title.length > 200) throw new Error("De titel is verplicht (maximaal 200 tekens).");
  if (description.length > 10000 || location.length > 300) throw new Error("De beschrijving of locatie is te lang.");
  if (!categories.some(category => category.key === draft.category)) throw new Error("Kies een bekend activiteitstype.");
  const timing = draft.all_day
    ? { all_day: true, start_date: civil(draft.start).toString(), end_date: civil(draft.end).toString(), starts_at: null, ends_at: null }
    : { all_day: false, start_date: null, end_date: null, starts_at: localToInstant(draft.start), ends_at: localToInstant(draft.end) };
  if (draft.all_day ? timing.end_date! < timing.start_date! : Temporal.Instant.compare(timing.ends_at!, timing.starts_at!) < 0) throw new Error("Het einde moet op of na het begin vallen.");
  if (!["NONE", "WEEKLY", "MONTHLY"].includes(draft.frequency)) throw new Error("Onbekende herhaling.");
  if (!Number.isInteger(draft.recurrence_interval) || draft.recurrence_interval < 1 || draft.recurrence_interval > 52) throw new Error("Het interval moet tussen 1 en 52 liggen.");
  const days = [...new Set(draft.weekdays)].sort((a, b) => a - b);
  if (draft.frequency === "WEEKLY" && (!days.length || days.some(day => !Number.isInteger(day) || day < 1 || day > 7)
    || !days.includes(civil(draft.start.slice(0, 10)).dayOfWeek))) throw new Error("Kies weekdagen, waaronder de begindag.");
  const until = draft.frequency === "NONE" || !draft.until_date ? null : civil(draft.until_date).toString();
  if (until && until < draft.start.slice(0, 10)) throw new Error("Het einde van de herhaling valt vóór het begin.");
  const count = draft.frequency === "NONE" || !draft.occurrence_count ? null : Number(draft.occurrence_count);
  if (count !== null && (!Number.isInteger(count) || count < 1 || count > 10000)) throw new Error("Het aantal exemplaren moet tussen 1 en 10.000 liggen.");
  if (!["ALL", "SELECTED"].includes(draft.audience_type)) throw new Error("Kies de betrokken personen.");
  if (draft.audience_type === "SELECTED" && !draft.participant_ids.length) throw new Error("Selecteer minstens één lid.");
  if (draft.participant_ids.some(id => !/^[0-9a-f-]{36}$/i.test(id)) || new Set(draft.participant_ids).size !== draft.participant_ids.length) throw new Error("Ongeldige ledenlijst.");
  return { ...timing, timezone: EVENT_ZONE, title, description, location, category: draft.category,
    audience_type: draft.audience_type, participant_ids: draft.audience_type === "ALL" ? [] : draft.participant_ids,
    frequency: draft.frequency, recurrence_interval: draft.frequency === "NONE" ? 1 : draft.recurrence_interval,
    weekdays: draft.frequency === "WEEKLY" ? days : [], until_date: until, occurrence_count: count };
}

export function makeDraft(event?: CalendarEvent | EventOccurrence, participantIds: string[] = [], date = today()): EventDraft {
  const series = event && "event" in event ? event.event : event;
  return {
    title: event?.title ?? "", description: event?.description ?? "", category: event?.category ?? "ACTIVITY", location: event?.location ?? "",
    all_day: event?.all_day ?? false,
    start: event ? event.all_day ? event.start_date! : instantToLocal(event.starts_at!) : `${date}T14:00`,
    end: event ? event.all_day ? event.end_date! : instantToLocal(event.ends_at!) : `${date}T18:00`,
    audience_type: series?.audience_type ?? "ALL", participant_ids: participantIds,
    frequency: series?.frequency ?? "NONE", recurrence_interval: series?.recurrence_interval ?? 1,
    weekdays: series?.weekdays.length ? series.weekdays : [civil(event ? startDay(event) : date).dayOfWeek],
    until_date: series?.until_date ?? "", occurrence_count: series?.occurrence_count?.toString() ?? ""
  };
}
