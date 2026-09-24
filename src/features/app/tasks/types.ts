export type TaskScope = "PERSONAL" | "TEAM";
export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
export type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type TaskRole = "LEAD" | "CONTRIBUTOR";
export type WorkStatus = "TODO" | "DONE";
export interface Task {
  id: string; scope: TaskScope; owner_member_id: string | null; owner_user_id: string | null;
  title: string; description: string | null; status: TaskStatus; priority: TaskPriority;
  deadline_date: string | null; deadline_at: string | null; timezone: "Europe/Brussels";
  event_id: string | null; event_occurrence_date: string | null;
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string; revision: number;
}
export interface TaskAssignment { member_id: string; role: TaskRole }
export interface TaskMember extends TaskAssignment { task_id: string; work_status: WorkStatus; created_at: string; updated_at: string }
export type TaskAction = "TASK_CREATED" | "TASK_UPDATED" | "STATUS_CHANGED" | "TASK_CANCELLED" | "MEMBER_ADDED" | "MEMBER_REMOVED" | "MEMBER_ROLE_CHANGED" | "MEMBER_WORK_COMPLETED" | "MEMBER_WORK_REOPENED";
export interface TaskActivity { id: string; task_id: string; actor_id: string | null; action: TaskAction; created_at: string; metadata: { fields?: string[]; member_id?: string; before?: string | null; after?: string | null } }
export interface TaskInput {
  reminders?: import("../notifications/types").Reminder[];
  scope: TaskScope; title: string; description: string; status: TaskStatus; priority: TaskPriority;
  deadline_date: string | null; deadline_at: string | null; timezone: "Europe/Brussels";
  event_id: string | null; event_occurrence_date: string | null;
}
export interface TaskDraft {
  scope: TaskScope; title: string; description: string; status: TaskStatus; priority: TaskPriority;
  deadline_kind: "NONE" | "DATE" | "TIMED"; deadline: string;
  event_id: string; event_occurrence_date: string; assignments: TaskAssignment[];
}
export const statusLabels: Record<TaskStatus, string> = { TODO: "Te doen", IN_PROGRESS: "Bezig", DONE: "Afgerond", CANCELLED: "Geannuleerd" };
export const priorityLabels: Record<TaskPriority, string> = { LOW: "Laag", NORMAL: "Normaal", HIGH: "Hoog", URGENT: "Dringend" };
export const roleLabels: Record<TaskRole, string> = { LEAD: "Verantwoordelijke", CONTRIBUTOR: "Deelnemer" };
