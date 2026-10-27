import { hasPermission, type Profile } from "../../lib/auth/access.ts";
import { siteTabs } from "../../features/site/navigation.ts";

export const adminTabDefinitions = [
  ...siteTabs.map(tab => ({ ...tab, domain: "site" as const }))
];
export type TabId = typeof adminTabDefinitions[number]["id"];
export type AdminTab = typeof adminTabDefinitions[number];
export interface NavigationGroup { groupId: "site"; label: string; tabs: AdminTab[] }

export function getAvailableTabs(profile: Profile | null) {
  if (!profile) return [];
  return adminTabDefinitions.filter(tab => hasPermission(profile, tab.permission));
}

export function resolveTab(requested: TabId, profile: Profile | null): TabId | null {
  const tabs = getAvailableTabs(profile);
  return tabs.find(tab => tab.id === requested)?.id ?? tabs[0]?.id ?? null;
}

export function getNavigationGroups(profile: Profile | null): NavigationGroup[] {
  const tabs = getAvailableTabs(profile);
  return tabs.length ? [{ groupId: "site", label: "SITE", tabs }] : [];
}
