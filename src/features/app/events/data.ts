import type { SupabaseClient } from "@supabase/supabase-js";
import type { Member } from "../types.ts";
import type { Reminder } from "../notifications/types.ts";
import type { CalendarEvent, EventCategory, EventInput, EventOverride, EventParticipant } from "./types.ts";

export interface AgendaData { events: CalendarEvent[]; overrides: EventOverride[]; participants: EventParticipant[]; categories: EventCategory[]; members: Member[]; reminders: Reminder[] }
export const emptyAgenda: AgendaData = { events: [], overrides: [], participants: [], categories: [], members: [], reminders: [] };
async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await query(from, from + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}
export async function loadAgenda(client: SupabaseClient): Promise<AgendaData> {
  const [events, overrides, participants, categories, members, reminders] = await Promise.all([
    pages<CalendarEvent>((a, b) => client.from("events").select("*").order("id").range(a, b)),
    pages<EventOverride>((a, b) => client.from("event_occurrence_overrides").select("*").order("event_id").order("occurrence_date").range(a, b)),
    pages<EventParticipant>((a, b) => client.from("event_participants").select("*").order("event_id").order("member_id").range(a, b)),
    pages<EventCategory>((a, b) => client.from("event_categories").select("*").order("label").range(a, b)),
    pages<Member>((a, b) => client.from("members").select("*").order("last_name").order("first_name").order("id").range(a, b)),
    pages<Reminder>((a, b) => client.from("event_reminders").select("*").order("id").range(a, b))
  ]);
  return { events, overrides, participants, categories, members, reminders };
}
export async function saveEvent(client: SupabaseClient, event: CalendarEvent | null, input: EventInput, occurrenceDate?: string) {
  const { participant_ids, reminders, ...details } = input;
  const { error } = occurrenceDate && event
    ? await client.rpc("save_agenda_occurrence", { target_id: event.id, original_date: occurrenceDate, expected_revision: event.revision, details })
    : await client.rpc("save_agenda_event_with_reminders", { target_id: event?.id ?? null, expected_revision: event?.revision ?? null, details, participant_ids, reminders: reminders ?? null });
  if (error) throw error;
}
export async function cancelEvent(client: SupabaseClient, event: CalendarEvent, occurrenceDate: string | null) {
  const { error } = await client.rpc("cancel_agenda_event", { target_id: event.id, original_date: occurrenceDate, expected_revision: event.revision });
  if (error) throw error;
}
export function agendaError(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "40001") return "Cet événement a été modifié ailleurs. Fermez le formulaire, actualisez l’agenda puis reprenez votre modification.";
    if (error.code === "42501") return "Vous n’avez plus les droits nécessaires. Actualisez vos accès.";
    if (error.code === "22023") return "Vérifiez les participants et la répétition. Un membre peut avoir été archivé ; les dates d’origine des exceptions doivent rester dans la série.";
    if (error.code === "23514" || error.code === "23503" || error.code === "23502") return "Données invalides : vérifiez le titre, les dates, le type et les membres sélectionnés.";
  }
  return error instanceof Error ? error.message : "Impossible de charger ou d’enregistrer l’agenda. Réessayez.";
}
