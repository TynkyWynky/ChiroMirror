import { useEffect, useRef, useState } from "preact/hooks";
import AdminIcon from "./AdminIcon";

interface Props {
  groups: Array<{ groupId: string; label: string; tabs: Array<{ id: string; label: string; description: string }> }>;
  activeTab: string;
  badges: Partial<Record<string, string>>;
  userName: string;
  role: string;
  onNavigate: (tab: string) => void;
  onSignOut: () => void;
}

export default function AdminNavigation(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const media = window.matchMedia("(min-width: 901px)");
    const close = () => { if (media.matches) dialog.current?.close(); };
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);

  function navigate(tab: string) {
    props.onNavigate(tab);
    dialog.current?.close();
    setQuery("");
  }

  function navigation(mobile = false) {
    const groups = props.groups.map(group => ({ ...group, tabs: group.tabs.filter(tab => `${tab.label} ${tab.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) })).filter(group => group.tabs.length);
    return <>
      <div class="admin-brand">
        <span class="admin-brand-mark">N.</span>
        <div><strong>Negenmanneke</strong><span>Beheeromgeving</span></div>
        {mobile && <button class="admin-icon-button" type="button" aria-label="Menu sluiten" onClick={() => dialog.current?.close()}><AdminIcon name="close" /></button>}
      </div>
      <label class="admin-nav-search"><AdminIcon name="search" /><input type="search" aria-label="Zoek een onderdeel" placeholder="Zoek een onderdeel…" value={query} onInput={event => setQuery(event.currentTarget.value)} /></label>
      <nav class="admin-sidebar-nav" aria-label="Admin onderdelen">
        {groups.map(group => <section class="admin-sidebar-section" key={group.groupId}>
          <p class="admin-sidebar-section-label">{group.label}</p>
          {group.tabs.map(tab => <button class={`admin-sidebar-tab ${props.activeTab === tab.id ? "is-active" : ""}`} type="button" key={tab.id} aria-current={props.activeTab === tab.id ? "page" : undefined} title={tab.description} onClick={() => navigate(tab.id)}>
            <AdminIcon name={tab.id} /><span>{tab.label}</span>{props.badges[tab.id] && <small>{props.badges[tab.id]}</small>}
          </button>)}
        </section>)}
        {!groups.length && <p class="admin-nav-empty">Geen onderdelen gevonden.</p>}
      </nav>
      <div class="admin-sidebar-foot">
        <span class="admin-avatar">{props.userName.slice(0, 1).toLocaleUpperCase()}</span>
        <div class="admin-user"><strong>{props.userName}</strong><span>{props.role === "admin" ? "Beheerder" : "Editor"}</span></div>
        <button class="admin-icon-button" type="button" onClick={props.onSignOut} aria-label="Uitloggen" title="Uitloggen"><AdminIcon name="logout" /></button>
      </div>
    </>;
  }

  return <>
    <aside class="admin-sidebar">{navigation()}</aside>
    <button class="admin-icon-button admin-mobile-nav-trigger" type="button" aria-label="Navigatie openen" onClick={() => dialog.current?.showModal()}><AdminIcon name="menu" /></button>
    <dialog class="admin-nav-dialog" ref={dialog} aria-label="Navigatie" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div class="admin-mobile-sidebar">{navigation(true)}</div>
    </dialog>
  </>;
}
