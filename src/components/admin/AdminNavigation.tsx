import { useEffect, useRef, useState } from "preact/hooks";
import AdminIcon from "./AdminIcon";
import { siteRoleLabel, type SiteRole } from "../../lib/auth/access";
import type { NavigationGroup, TabId } from "./navigation";

interface Props {
  groups: NavigationGroup[];
  activeTab: TabId;
  badges: Partial<Record<TabId, string>>;
  userName: string;
  role: SiteRole;
  onNavigate: (tab: TabId) => void;
  onSignOut: () => void;
}

export default function AdminNavigation(props: Props) {
  const app = props.activeTab.startsWith("app-");
  const t = (appLabel: string, siteLabel: string) => app ? appLabel : siteLabel;
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const media = window.matchMedia("(min-width: 901px)");
    const close = () => { if (media.matches) dialog.current?.close(); };
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);

  function navigate(tab: TabId) {
    props.onNavigate(tab);
    dialog.current?.close();
    setQuery("");
  }

  function navigation(mobile = false) {
    const groups = props.groups.map(group => ({ ...group, tabs: group.tabs.filter(tab => `${tab.label} ${tab.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) })).filter(group => group.tabs.length);
    return <>
      <div class="admin-brand">
        <span class="admin-brand-mark">N.</span>
        <div><strong>Negenmanneke</strong><span>{t("Interne omgeving", "Beheeromgeving")}</span></div>
        {mobile && <button class="admin-icon-button" type="button" aria-label={t("Menu sluiten", "Menu sluiten")} onClick={() => dialog.current?.close()}><AdminIcon name="close" /></button>}
      </div>
      {props.groups.length > 1 && <div class="admin-workspace-switch" role="group" aria-label={t("Kies een omgeving", "Kies een omgeving")}>
        {props.groups.map(group => <button type="button" key={group.groupId} aria-pressed={group.groupId === (app ? "app" : "site")}
          title={group.groupId === "app" ? t("Open de interne app", "Open de interne app") : t("Beheer de website", "Beheer de website")}
          onClick={() => navigate(group.tabs[0].id)}>{group.label}</button>)}
      </div>}
      <label class="admin-nav-search"><AdminIcon name="search" /><input type="search" aria-label={t("Zoek een onderdeel", "Zoek een onderdeel")} placeholder={t("Zoek een onderdeel…", "Zoek een onderdeel…")} value={query} onInput={event => setQuery(event.currentTarget.value)} /></label>
      <nav class="admin-sidebar-nav" aria-label={t("Onderdelen", "Admin onderdelen")}>
        {groups.map(group => <section class="admin-sidebar-section" key={group.groupId}>
          <p class="admin-sidebar-section-label">{group.label}</p>
          {group.tabs.map(tab => <button class={`admin-sidebar-tab ${props.activeTab === tab.id ? "is-active" : ""}`} type="button" key={tab.id} aria-current={props.activeTab === tab.id ? "page" : undefined} title={tab.description} onClick={() => navigate(tab.id)}>
            <AdminIcon name={tab.id} /><span>{tab.label}</span>{props.badges[tab.id] && <small>{props.badges[tab.id]}</small>}
          </button>)}
        </section>)}
        {!groups.length && <p class="admin-nav-empty">{t("Geen onderdelen gevonden.", "Geen onderdelen gevonden.")}</p>}
      </nav>
      <div class="admin-sidebar-foot">
        <span class="admin-avatar">{props.userName.slice(0, 1).toLocaleUpperCase()}</span>
        <div class="admin-user"><strong>{props.userName}</strong><span>{app ? { none: "Geen SITE-toegang", editor: "SITE-editor", admin: "SITE-beheerder" }[props.role] : siteRoleLabel(props.role)}</span></div>
        <button class="admin-icon-button" type="button" onClick={props.onSignOut} aria-label={t("Uitloggen", "Uitloggen")} title={t("Uitloggen", "Uitloggen")}><AdminIcon name="logout" /></button>
      </div>
    </>;
  }

  return <>
    <aside class="admin-sidebar">{navigation()}</aside>
    {app && <nav class="app-bottom-nav" aria-label="APP-navigatie">
      {props.groups.flatMap(group=>group.tabs).filter(tab=>["app-home","app-agenda","app-tasks","app-finance"].includes(tab.id)).map(tab=><button type="button" key={tab.id} aria-current={props.activeTab===tab.id?"page":undefined} onClick={()=>navigate(tab.id)}><AdminIcon name={tab.id}/><span>{tab.label}</span></button>)}
      <button type="button" aria-label="Meer onderdelen" aria-haspopup="dialog" aria-current={["app-members","app-settings","app-notifications"].includes(props.activeTab)?"page":undefined} onClick={()=>dialog.current?.showModal()}><AdminIcon name="menu"/><span>Meer</span></button>
    </nav>}
    <button class="admin-icon-button admin-mobile-nav-trigger" type="button" aria-label={t("Navigatie openen", "Navigatie openen")} onClick={() => dialog.current?.showModal()}><AdminIcon name="menu" /></button>
    <dialog class="admin-nav-dialog" ref={dialog} aria-label={t("Navigatie", "Navigatie")} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div class="admin-mobile-sidebar">{navigation(true)}</div>
    </dialog>
  </>;
}
