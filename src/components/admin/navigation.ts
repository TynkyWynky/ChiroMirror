import { hasPermission, type Profile } from "../../lib/auth/access.ts";
import { siteTabs } from "../../features/site/navigation.ts";
import { appTabs } from "../../features/app/navigation.ts";
import { hasAppPermission } from "../../features/app/access.ts";
import type { AppPermission } from "../../features/app/types.ts";

export const adminTabDefinitions = [
  ...siteTabs.map(tab => ({ ...tab, domain: "site" as const })),
  ...appTabs.map(tab => ({ ...tab, domain: "app" as const }))
];
export type TabId = typeof adminTabDefinitions[number]["id"];
export type AdminTab = typeof adminTabDefinitions[number];
export interface NavigationGroup { groupId: "site" | "app"; label: string; tabs: AdminTab[] }

export function getAvailableTabs(profile: Profile | null, permissions: AppPermission[] = []) {
  if (!profile) return [];
  return adminTabDefinitions.filter(tab => tab.domain === "site" ? hasPermission(profile, tab.permission) : hasAppPermission(permissions, tab.permission));
}

export function resolveTab(requested: TabId, profile: Profile | null, permissions: AppPermission[] = []): TabId | null {
  const tabs = getAvailableTabs(profile, permissions);
  return tabs.find(tab => tab.id === requested)?.id ?? tabs[0]?.id ?? null;
}

export function getNavigationGroups(profile: Profile | null, permissions: AppPermission[] = []): NavigationGroup[] {
  const tabs = getAvailableTabs(profile, permissions);
  return (["site", "app"] as const).map(domain => ({
    groupId: domain, label: domain.toUpperCase(), tabs: tabs.filter(tab => tab.domain === domain)
  })).filter(group => group.tabs.length > 0);
}
