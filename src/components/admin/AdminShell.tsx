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
  notificationControl?: ComponentChildren;
}

export default function AdminShell(props: Props) {
  const app = props.activeTab.domain === "app";
  const refreshLabel = app ? "Actualiser les données" : "Gegevens verversen";
  return <div class="admin-app" lang={app ? "fr" : "nl"}>
    <AdminNavigation groups={props.groups} activeTab={props.activeTab.id} badges={props.badges}
      userName={props.userName} role={props.role} onNavigate={props.onNavigate} onSignOut={props.onSignOut} />
    <main class="admin-main" id="admin-content">
      <header class="admin-topbar">
        <div class="admin-breadcrumb"><span>{props.activeTab.domain.toUpperCase()}</span><AdminIcon name="chevron" /><strong>{props.activeTab.label}</strong></div>
        <div class="admin-topbar-actions">
          {app && props.notificationControl}
          <button class="admin-icon-button" type="button" aria-label={refreshLabel} title={refreshLabel} disabled={props.refreshDisabled} onClick={props.onRefresh}><AdminIcon name="refresh" /></button>
          <a class="admin-text-button" href="/" target="_blank" rel="noreferrer">{app ? "Voir le site" : "Bekijk site"}<AdminIcon name="external" /></a>
        </div>
      </header>
      <div class={"admin-main-shell " + (props.activeTab.id === "finance" ? "is-finance" : "")}>
        {props.notice && <div class={"admin-notice admin-notice-" + props.notice.type} role={props.notice.type === "error" ? "alert" : "status"}>{props.notice.message}</div>}
        {props.loading && <div class="admin-loading-inline" role="status">{app ? "Actualisation des données…" : "Gegevens worden ververst…"}</div>}
        {props.children}
      </div>
    </main>
  </div>;
}
