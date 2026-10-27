import type { ComponentChildren } from "preact";
import type { SiteRole } from "../../lib/auth/access";
import type { AdminTab, NavigationGroup, TabId } from "./navigation";
import AdminNavigation from "./AdminNavigation";
import AdminIcon from "./AdminIcon";

export type Notice = { type: "success" | "error"; message: string } | null;

interface Props {
  groups: NavigationGroup[];
  activeTab: AdminTab;
  badges: Partial<Record<TabId, string>>;
  userName: string;
  role: SiteRole;
  notice: Notice;
  loading: boolean;
  refreshDisabled: boolean;
  onNavigate: (tab: TabId) => void;
  onSignOut: () => void;
  onRefresh: () => void;
  children: ComponentChildren;
}

export default function AdminShell(props: Props) {
  return <div class="admin-app" lang="nl">
    <AdminNavigation groups={props.groups} activeTab={props.activeTab.id} badges={props.badges}
      userName={props.userName} role={props.role} onNavigate={props.onNavigate} onSignOut={props.onSignOut} />
    <main class="admin-main" id="admin-content">
      <header class="admin-topbar">
        <div class="admin-breadcrumb"><span>{props.activeTab.domain.toUpperCase()}</span><AdminIcon name="chevron" /><strong>{props.activeTab.label}</strong></div>
        <div class="admin-topbar-actions">
          <button class="admin-icon-button" type="button" aria-label="Gegevens verversen" title="Gegevens verversen" disabled={props.refreshDisabled} onClick={props.onRefresh}><AdminIcon name="refresh" /></button>
          <a class="admin-text-button" href="/" target="_blank" rel="noopener noreferrer">Bekijk site<AdminIcon name="external" /></a>
        </div>
      </header>
      <div class={"admin-main-shell " + (props.activeTab.id === "finance" ? "is-finance" : "")}>
        {props.notice && <div class={"admin-notice admin-notice-" + props.notice.type} role={props.notice.type === "error" ? "alert" : "status"}>{props.notice.message}</div>}
        {props.loading && <div class="admin-loading-inline" role="status">Gegevens worden ververst…</div>}
        {props.children}
      </div>
    </main>
  </div>;
}
