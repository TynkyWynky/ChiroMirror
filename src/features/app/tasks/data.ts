import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOnline, networkError } from "../pwa/network.ts";
import type { AppAccess, Member } from "../types.ts";
import { hasAppPermission } from "../access.ts";
import type { CalendarEvent, EventOverride } from "../events/types.ts";
import type { Task, TaskActivity, TaskAssignment, TaskInput, TaskMember, WorkStatus } from "./types.ts";
import type { Reminder } from "../notifications/types.ts";

export interface TasksData { tasks: Task[]; assignments: TaskMember[]; members: Member[]; events: CalendarEvent[]; overrides: EventOverride[]; reminders: Reminder[] }
export const emptyTasks: TasksData = { tasks: [], assignments: [], members: [], events: [], overrides: [], reminders: [] };
async function pages<T>(read: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let a = 0; ; a += 500) { const { data, error } = await read(a, a + 499); if (error) throw error; rows.push(...(data ?? [])); if (!data || data.length < 500) return rows; }
}
export async function loadTasks(client: SupabaseClient, access: AppAccess, summary = false): Promise<TasksData> {
  const readEvents = !summary && hasAppPermission(access.permissions, "events.read");
  const [tasks, assignments, members, events, overrides, reminders] = await Promise.all([
    pages<Task>((a, b) => client.from("tasks").select("*").order("id").range(a, b)),
    pages<TaskMember>((a, b) => client.from("task_members").select("*").order("task_id").order("member_id").range(a, b)),
    !summary ? pages<Member>((a, b) => client.from("members").select("*").order("last_name").order("id").range(a, b)) : Promise.resolve([]),
    readEvents ? pages<CalendarEvent>((a, b) => client.from("events").select("*").order("id").range(a, b)) : Promise.resolve([]),
    readEvents ? pages<EventOverride>((a, b) => client.from("event_occurrence_overrides").select("*").order("event_id").order("occurrence_date").range(a, b)) : Promise.resolve([]),
    !summary ? pages<Reminder>((a, b) => client.from("task_reminders").select("*").order("id").range(a, b)) : Promise.resolve([])
  ]);
  return { tasks, assignments, members, events, overrides, reminders };
}
export async function loadTaskActivity(client: SupabaseClient, taskId: string) {
  const { data, error } = await client.from("task_activity").select("*").eq("task_id", taskId).order("created_at", { ascending: false }).order("id").limit(100);
  if (error) throw error;
  return (data ?? []) as TaskActivity[];
}
export async function saveTask(client: SupabaseClient, task: Task | null, details: TaskInput, assignments: TaskAssignment[]) {
  requireOnline();
  const { reminders, ...fields } = details;
  const { error } = await client.rpc("save_task_with_reminders", { target_id: task?.id ?? null, expected_revision: task?.revision ?? null, details: fields, assignments, reminders: reminders ?? null });
  if (error) throw error;
}
export async function setMyWorkStatus(client: SupabaseClient, task: Task, status: WorkStatus) {
  requireOnline();
  const { error } = await client.rpc("set_my_task_work_status", { target_id: task.id, expected_revision: task.revision, new_status: status });
  if (error) throw error;
}
export function taskError(error: unknown): string {
  const network = networkError(error); if(network)return network;
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "40001") return "Deze taak is elders gewijzigd. Sluit het formulier, ververs en probeer opnieuw.";
    if (error.code === "42501") return "Je hebt niet de vereiste rechten voor deze actie. Controleer je lidkoppeling en ververs je toegangsrechten.";
    if (["22023", "23514", "23503", "23502", "23505", "22P02"].includes(String(error.code))) return "Controleer de gegevens: minstens één verantwoordelijke, actieve leden zonder dubbels, een geldige deadline en activiteit.";
  }
  return error instanceof Error ? error.message : "De taken konden niet worden geladen of opgeslagen. Probeer opnieuw.";
}
