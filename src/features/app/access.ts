import type { AppAccess, AppPermission } from "./types.ts";

export const emptyAppAccess: AppAccess = { permissions: [], roles: [], member: null };
export function hasAppPermission(permissions: readonly AppPermission[], permission: AppPermission): boolean {
  return permissions.includes("app.access") && permissions.includes(permission);
}
