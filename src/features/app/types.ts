export type AppPermission = "app.access" | "members.read" | "members.manage" | "roles.read" | "roles.manage"
  | "events.read" | "events.create" | "events.update" | "events.delete"
  | "tasks.create_team" | "tasks.read_all" | "tasks.manage_all"
  | "finance.access" | "finance.treasury.read" | "finance.treasury.manage";
export type AppRoleKey = "APP_ADMIN" | "RESPONSIBLE" | "TREASURER" | "MEMBER";
export interface AppRole { key: AppRoleKey; label: string; system: boolean }
export interface Member {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}
export type MemberInput = Pick<Member, "user_id" | "first_name" | "last_name" | "active">;
export interface AppUserRole { user_id: string; role_key: AppRoleKey; assigned_by: string | null; assigned_at: string }
export interface AppAccount { user_id: string; email: string; full_name: string; member_id: string | null }
export interface AppAccess { permissions: AppPermission[]; roles: AppRole[]; member: Member | null }
