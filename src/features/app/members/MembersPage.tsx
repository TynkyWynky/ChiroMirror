import { useEffect, useRef, useState } from "preact/hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasAppPermission } from "../access";
import { appError, loadMembersData, saveAccountRoles, saveMember, setMemberActive } from "../data";
import type { AppAccess, Member, MemberInput } from "../types";
import MemberForm from "./MemberForm";
import AccountRoles from "./AccountRoles";
import InviteAccount from "./InviteAccount";
import "./members.css";

type MembersData = Awaited<ReturnType<typeof loadMembersData>>;
interface Props { client: SupabaseClient; access: AppAccess; onAccessChanged: () => Promise<void> }

export default function MembersPage({ client, access, onAccessChanged }: Props) {
  const [data, setData] = useState<MembersData>({ members: [], accounts: [], roles: [], assignments: [] });
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [feedback, setFeedback] = useState("");
  const [search, setSearch] = useState(""), [status, setStatus] = useState("active");
  const [editing, setEditing] = useState<Member | null | undefined>(undefined);
  const [revision, setRevision] = useState(0);
  const requestId = useRef(0);
  const manage = hasAppPermission(access.permissions, "members.manage");
  const readRoles = hasAppPermission(access.permissions, "roles.read");
  const manageRoles = hasAppPermission(access.permissions, "roles.manage");

  async function reload() {
    const id = ++requestId.current;
    setLoading(true); setError("");
    try {
      const next = await loadMembersData(client, access.permissions);
      if (id === requestId.current) { setData(next); setRevision(value => value + 1); }
    } catch (cause) { if (id === requestId.current) { setData({ members: [], accounts: [], roles: [], assignments: [] }); setError(appError(cause)); } }
    finally { if (id === requestId.current) setLoading(false); }
  }
  useEffect(() => { void reload(); return () => { requestId.current++; }; }, [client, access]);

  async function mutate(action: () => Promise<void>, message: string) {
    if (busy) return;
    setBusy(true); setError(""); setFeedback("");
    try { await action(); setFeedback(message); await reload(); await onAccessChanged(); }
    catch (cause) { setError(appError(cause)); }
    finally { setBusy(false); }
  }
  async function submitMember(input: MemberInput) {
    if (editing?.active && !input.active && !window.confirm("Archiver ce membre ? Ses accès APP restent actifs tant que ses rôles ne sont pas retirés.")) return;
    await mutate(async () => { await saveMember(client, editing?.id ?? null, input); setEditing(undefined); }, "Membre enregistré.");
  }
  const query = search.trim().toLocaleLowerCase("fr");
  const visible = data.members.filter(member =>
    (status === "all" || member.active === (status === "active")) &&
    `${member.first_name} ${member.last_name} ${member.first_name}`.toLocaleLowerCase("fr").includes(query));

  return <section class="admin-panel app-members" lang="fr" aria-busy={loading || busy}>
    <header class="admin-page-heading"><div><p class="admin-eyebrow">APP</p><h1>Membres</h1><p>Membres Chiro, comptes liés et rôles APP.</p></div></header>
    <div class="app-actions">
      {manage && <button class="btn" type="button" disabled={busy || loading} onClick={() => setEditing(null)}>Nouveau membre</button>}
      <button class="btn btn-light" type="button" disabled={busy || loading} onClick={() => { setEditing(undefined); void reload(); void onAccessChanged(); }}>Actualiser</button>
    </div>
    {error && <p role="alert" class="app-error">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {editing !== undefined && manage && <MemberForm key={editing?.id ?? "new"} member={editing} accounts={data.accounts} busy={busy || loading} onSave={submitMember} onCancel={() => setEditing(undefined)} />}
    <div class="app-member-fields app-filters">
      <label>Rechercher par nom<input type="search" value={search} onInput={event => setSearch(event.currentTarget.value)} /></label>
      <label>Statut<select value={status} onChange={event => setStatus(event.currentTarget.value)}><option value="active">Actif</option><option value="inactive">Inactif</option><option value="all">Tous les membres</option></select></label>
    </div>
    {loading ? <p role="status">Chargement des membres…</p> : !error && <>
      <p class="muted">{visible.length} membres</p>
      {!visible.length && <p>Aucun membre trouvé. Modifiez vos filtres{manage ? " ou ajoutez un membre" : ""}.</p>}
      <ul class="app-member-list">{visible.map(member => <li key={member.id} class="admin-subpanel app-member-row">
        <div><h2>{member.first_name} {member.last_name}</h2>
          <p><span class="app-badge">{member.active ? "Actif" : "Inactif"}</span> <span class="app-badge">{member.user_id ? "Compte lié" : "Aucun compte"}</span></p>
          {readRoles && member.user_id && <p>Rôles APP : {data.assignments.filter(row => row.user_id === member.user_id).map(row => data.roles.find(role => role.key === row.role_key)?.label ?? row.role_key).join(", ") || "Aucun"}</p>}
        </div>
        {manage && <div class="app-actions"><button class="btn btn-light" type="button" disabled={busy} onClick={() => setEditing(member)}>Modifier</button>
          <button class="btn btn-light" type="button" disabled={busy} onClick={() => {
            if (window.confirm(`${member.first_name} ${member.last_name} ${member.active ? "archiver" : "réactiver"} ? Cette action ne modifie pas les rôles APP.`)) {
              void mutate(async () => { await setMemberActive(client, member.id, !member.active); setEditing(undefined); }, member.active ? "Membre archivé." : "Membre réactivé.");
            }
          }}>{member.active ? "Archiver" : "Réactiver"}</button></div>}
      </li>)}</ul>
    </>}
    {!loading && !error && manageRoles && <AccountRoles key={revision} accounts={data.accounts} roles={data.roles} assignments={data.assignments} busy={busy} onSave={(id, roles) => mutate(() => saveAccountRoles(client, id, roles), "Rôles APP enregistrés.")} />}
    {manage && manageRoles && <InviteAccount client={client} members={data.members} roles={data.roles} onInvited={reload} />}
  </section>;
}
