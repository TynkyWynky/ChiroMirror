import type { ContactMessage, Post } from "@/types/content";
import AdminIcon from "./AdminIcon";

interface Props {
  userName: string;
  date: string;
  posts: Post[];
  messages: ContactMessage[];
  groupCount: number;
  pendingCount: number;
  canUseFinance: boolean;
  warnings: Array<{ id: string; label: string; detail: string; tabId: string }>;
  onNavigate: (tab: string) => void;
  onNewPost: () => void;
  onEditPost: (id: string) => void;
}

function formatDate(value?: string) {
  if (!value || Number.isNaN(Date.parse(value))) return "—";
  return new Date(value).toLocaleDateString("nl-BE", { day: "numeric", month: "short" });
}

export default function AdminOverview(props: Props) {
  const published = props.posts.filter(post => post.published).length;
  const recent = [...props.posts].sort((a, b) => (Date.parse(b.createdAt || b.eventDate) || 0) - (Date.parse(a.createdAt || a.eventDate) || 0)).slice(0, 5);
  const metrics = [
    { label: "Gepubliceerde posts", value: published, detail: `${props.posts.length - published} concepten`, tab: "posts", icon: "posts" },
    { label: "Contactberichten", value: props.messages.length, detail: "Bekijk je inbox", tab: "messages", icon: "messages" },
    { label: "Groepen", value: props.groupCount, detail: "Groepen en leiding beheren", tab: "groups", icon: "groups" },
    { label: props.canUseFinance ? "Openstaande transacties" : "Aandachtspunten", value: props.canUseFinance ? props.pendingCount : props.warnings.length, detail: props.canUseFinance ? "Bekijk de financiën" : "Controleer je website", tab: props.canUseFinance ? "finance" : "site", icon: props.canUseFinance ? "finance" : "site" }
  ];
  return <div class="admin-dashboard">
    <header class="admin-page-heading"><div><p class="admin-eyebrow">{props.date}</p><h1>Overzicht</h1><p>Welkom, {props.userName.split(" ")[0]}. Dit staat er op de agenda.</p></div><button class="btn" type="button" onClick={props.onNewPost}><AdminIcon name="plus" />Nieuwe post maken</button></header>
    <div class="admin-dashboard-metrics">{metrics.map(metric => <button type="button" class="admin-metric" key={metric.label} onClick={() => props.onNavigate(metric.tab)}><span class="admin-metric-label">{metric.label}<AdminIcon name={metric.icon} /></span><strong>{metric.value}</strong><span class="admin-metric-detail">{metric.detail}<AdminIcon name="arrow" /></span></button>)}</div>
    <div class="admin-dashboard-columns">
      <section class="admin-work-card"><header><div><h2>Recente posts</h2><p>Je laatste nieuws en activiteiten.</p></div><button type="button" class="admin-text-button" onClick={() => props.onNavigate("posts")}>Alle posts<AdminIcon name="arrow" /></button></header>
        {recent.length ? <div class="admin-table-wrap"><table class="admin-data-table"><thead><tr><th>Bericht</th><th>Status</th><th>Datum</th><th><span class="admin-sr-only">Bewerken</span></th></tr></thead><tbody>{recent.map(post => <tr key={post.id}><td><button class="admin-table-title" type="button" onClick={() => post.id && props.onEditPost(post.id)}>{post.title || "Naamloos concept"}</button>{post.featured && <small>Uitgelicht op de homepage</small>}</td><td><span class={`admin-status ${post.published ? "is-published" : "is-draft"}`}>{post.published ? "Gepubliceerd" : "Concept"}</span></td><td class="admin-table-date">{formatDate(post.eventDate || post.createdAt)}</td><td><button type="button" class="admin-icon-button" aria-label={`Bewerk ${post.title || "concept"}`} onClick={() => post.id && props.onEditPost(post.id)}><AdminIcon name="chevron" /></button></td></tr>)}</tbody></table></div> : <div class="admin-empty"><AdminIcon name="posts" /><strong>Je eerste bericht begint hier</strong><p>Deel een activiteit, een foto of nieuws met de ouders.</p><button class="btn btn-light" type="button" onClick={props.onNewPost}>Maak een post</button></div>}
      </section>
      <section class="admin-work-card"><header><div><h2>Aandacht nodig</h2><p>Een korte checklist voor je website.</p></div><span class="admin-count">{props.warnings.length}</span></header><div class="admin-task-list">{props.warnings.length ? props.warnings.slice(0, 5).map(item => <button type="button" class="admin-task-row" key={item.id} onClick={() => props.onNavigate(item.tabId)}><span class="admin-task-dot" /><span><strong>{item.label}</strong><small>{item.detail}</small></span><AdminIcon name="chevron" /></button>) : <div class="admin-empty"><AdminIcon name="check" /><strong>Alles is bijgewerkt</strong><p>Er zijn momenteel geen aandachtspunten.</p></div>}</div></section>
    </div>
    <section class="admin-work-card"><header><div><h2>Recente berichten</h2><p>Vragen van ouders en bezoekers.</p></div><button type="button" class="admin-text-button" onClick={() => props.onNavigate("messages")}>Open inbox<AdminIcon name="arrow" /></button></header>{props.messages.length ? <div class="admin-inbox-preview">{props.messages.slice(0, 4).map(message => <button type="button" class="admin-inbox-row" key={message.id} onClick={() => props.onNavigate("messages")}><span class="admin-avatar">{(message.name || "?").slice(0, 1).toUpperCase()}</span><span class="admin-inbox-sender"><strong>{message.name}</strong><small>{message.email}</small></span><span class="admin-inbox-subject"><strong>{message.subject}</strong><small>{message.message}</small></span><time>{formatDate(message.createdAt)}</time><AdminIcon name="chevron" /></button>)}</div> : <div class="admin-empty admin-empty-inline"><AdminIcon name="messages" /><div><strong>Je inbox is leeg</strong><p>Nieuwe contactberichten verschijnen hier.</p></div></div>}</section>
    <footer class="admin-dashboard-footer"><span>Negenmanneke · Beheeromgeving</span><a href="/" target="_blank" rel="noreferrer">Website bekijken<AdminIcon name="external" /></a></footer>
  </div>;
}
