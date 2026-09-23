import { hasAppPermission } from "../access.ts";
import type { AppAccess } from "../types.ts";
import type { Task, TaskMember } from "./types.ts";

export function personalAssignment(task: Task, members: TaskMember[], access: AppAccess) {
  return members.find(member => member.task_id === task.id && member.member_id === access.member?.id);
}
export function canManageTask(task: Task, members: TaskMember[], access: AppAccess, userId: string) {
  if (!hasAppPermission(access.permissions, "app.access")) return false;
  if (task.scope === "PERSONAL") return task.owner_member_id === access.member?.id && task.owner_user_id === userId;
  return hasAppPermission(access.permissions, "tasks.manage_all") || personalAssignment(task, members, access)?.role === "LEAD"
    || (task.created_by === userId && hasAppPermission(access.permissions, "tasks.create_team"));
}
export function canCompleteTask(task: Task, members: TaskMember[], access: AppAccess, userId: string) {
  if (!hasAppPermission(access.permissions, "app.access")) return false;
  return task.scope === "PERSONAL" ? canManageTask(task, members, access, userId)
    : hasAppPermission(access.permissions, "tasks.manage_all") || personalAssignment(task, members, access)?.role === "LEAD";
}
export function taskProgress(taskId: string, members: TaskMember[]) {
  const participants = members.filter(member => member.task_id === taskId);
  return { total: participants.length, done: participants.filter(member => member.work_status === "DONE").length };
}
