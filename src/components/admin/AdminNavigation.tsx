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
  const t = (fr: string, nl: string) => app ? fr : nl;
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
        <div><strong>Negenmanneke</strong><span>{t("Espace interne", "Beheeromgeving")}</span></div>
        {mobile && <button class="admin-icon-button" type="button" aria-label={t("Fermer le menu", "Menu sluiten")} onClick={() => dialog.current?.close()}><AdminIcon name="close" /></button>}
      </div>
      <label class="admin-nav-search"><AdminIcon name="search" /><input type="search" aria-label={t("Rechercher une rubrique", "Zoek een onderdeel")} placeholder={t("Rechercher une rubrique…", "Zoek een onderdeel…")} value={query} onInput={event => setQuery(event.currentTarget.value)} /></label>
      <nav class="admin-sidebar-nav" aria-label={t("Rubriques", "Admin onderdelen")}>
        {groups.map(group => <section class="admin-sidebar-section" key={group.groupId}>
          <p class="admin-sidebar-section-label">{group.label}</p>
          {group.tabs.map(tab => <button class={`admin-sidebar-tab ${props.activeTab === tab.id ? "is-active" : ""}`} type="button" key={tab.id} aria-current={props.activeTab === tab.id ? "page" : undefined} title={tab.description} onClick={() => navigate(tab.id)}>
            <AdminIcon name={tab.id} /><span>{tab.label}</span>{props.badges[tab.id] && <small>{props.badges[tab.id]}</small>}
          </button>)}
        </section>)}
        {!groups.length && <p class="admin-nav-empty">{t("Aucune rubrique trouvée.", "Geen onderdelen gevonden.")}</p>}
      </nav>
      <div class="admin-sidebar-foot">
        <span class="admin-avatar">{props.userName.slice(0, 1).toLocaleUpperCase()}</span>
        <div class="admin-user"><strong>{props.userName}</strong><span>{app ? { none: "Aucun accès SITE", editor: "Éditeur SITE", admin: "Administrateur SITE" }[props.role] : siteRoleLabel(props.role)}</span></div>
        <button class="admin-icon-button" type="button" onClick={props.onSignOut} aria-label={t("Se déconnecter", "Uitloggen")} title={t("Se déconnecter", "Uitloggen")}><AdminIcon name="logout" /></button>
      </div>
    </>;
  }

  return <>
    <aside class="admin-sidebar">{navigation()}</aside>
    {app && <nav class="app-bottom-nav" aria-label="Navigation APP">
      {props.groups.flatMap(group=>group.tabs).filter(tab=>["app-home","app-agenda","app-tasks","app-finance"].includes(tab.id)).map(tab=><button type="button" key={tab.id} aria-current={props.activeTab===tab.id?"page":undefined} onClick={()=>navigate(tab.id)}><AdminIcon name={tab.id}/><span>{tab.label}</span></button>)}
      <button type="button" aria-label="Plus de rubriques" aria-haspopup="dialog" aria-current={["app-members","app-settings","app-notifications"].includes(props.activeTab)?"page":undefined} onClick={()=>dialog.current?.showModal()}><AdminIcon name="menu"/><span>Plus</span></button>
    </nav>}
    <button class="admin-icon-button admin-mobile-nav-trigger" type="button" aria-label={t("Ouvrir la navigation", "Navigatie openen")} onClick={() => dialog.current?.showModal()}><AdminIcon name="menu" /></button>
    <dialog class="admin-nav-dialog" ref={dialog} aria-label={t("Navigation", "Navigatie")} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div class="admin-mobile-sidebar">{navigation(true)}</div>
    </dialog>
  </>;
}
