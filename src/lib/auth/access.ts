/** Identity is separate from SITE access. `none` grants no editorial rights. */
export type SiteRole = "none" | "editor" | "admin";

export interface Profile {
  user_id: string;
  email: string;
  full_name: string;
  role: SiteRole;
  managedGroupSlugs: string[];
  created_at: string;
}

export type Permission = "site.manage" | "site.team.manage" | "site.finance.manage";
type AccessProfile = Pick<Profile, "role" | "managedGroupSlugs">;

export function parseSiteRole(value: unknown): SiteRole {
  return value === "admin" || value === "editor" ? value : "none";
}

export function hasPermission(profile: AccessProfile | null | undefined, permission: Permission): boolean {
  if (!profile) return false;
  switch (permission) {
    case "site.manage": return profile.role === "admin" || profile.role === "editor";
    case "site.team.manage": return profile.role === "admin";
    case "site.finance.manage": return profile.role === "admin" ||
      (profile.role === "editor" && profile.managedGroupSlugs.length > 0);
    default: return false;
  }
}

export function canAccessFinance(profile: AccessProfile | null | undefined) {
  return hasPermission(profile, "site.finance.manage");
}

export function canManageFinanceGroup(profile: AccessProfile | null | undefined, groupSlug: string) {
  return Boolean(profile && (profile.role === "admin" ||
    (profile.role === "editor" && groupSlug && profile.managedGroupSlugs.includes(groupSlug))));
}

export function siteRoleLabel(role: SiteRole) {
  return { admin: "Beheerder", editor: "Editor", none: "Geen SITE-toegang" }[role];
}
