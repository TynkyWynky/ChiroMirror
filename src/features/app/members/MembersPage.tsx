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
  const maskedEmail = (email: string) => {
    const [local, domain] = email.split("@", 2);
    if (!local || !domain) return "verborgen";
    return `${local.slice(0, 2)}***@${domain}`;
  };

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
    if (editing?.active && !input.active && !window.confirm("Dit lid archiveren? De APP-toegang blijft actief zolang de rollen niet verwijderd zijn.")) return;
    await mutate(async () => { await saveMember(client, editing?.id ?? null, input); setEditing(undefined); }, "Lid opgeslagen.");
  }
  const query = search.trim().toLocaleLowerCase("nl");
  const visible = data.members.filter(member =>
    (status === "all" || member.active === (status === "active")) &&
    `${member.first_name} ${member.last_name} ${member.first_name}`.toLocaleLowerCase("nl").includes(query));

  return <section class="admin-panel app-members" lang="nl" aria-busy={loading || busy}>
    <header class="admin-page-heading"><div><p class="admin-eyebrow">APP</p><h1>Leden</h1><p>Chiro-leden, gekoppelde accounts en APP-rollen.</p></div></header>
    <div class="app-actions">
      {manage && <button class="btn" type="button" disabled={busy || loading} onClick={() => setEditing(null)}>Nieuw lid</button>}
      <button class="btn btn-light" type="button" disabled={busy || loading} onClick={() => { setEditing(undefined); void reload(); void onAccessChanged(); }}>Verversen</button>
    </div>
    {error && <p role="alert" class="app-error">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {editing !== undefined && manage && <MemberForm key={editing?.id ?? "new"} member={editing} accounts={data.accounts} busy={busy || loading} onSave={submitMember} onCancel={() => setEditing(undefined)} />}
    <div class="app-member-fields app-filters">
      <label>Zoeken op naam<input type="search" value={search} onInput={event => setSearch(event.currentTarget.value)} /></label>
      <label>Status<select value={status} onChange={event => setStatus(event.currentTarget.value)}><option value="active">Actief</option><option value="inactive">Inactief</option><option value="all">Alle leden</option></select></label>
    </div>
    {loading ? <p role="status">Leden laden…</p> : !error && <>
      <p class="muted">{visible.length} leden</p>
      {!visible.length && <p>Geen leden gevonden. Pas je filters aan{manage ? " of voeg een lid toe" : ""}.</p>}
      <ul class="app-member-list">{visible.map(member => <li key={member.id} class="admin-subpanel app-member-row">
        <div><h2>{member.first_name} {member.last_name}</h2>
          <p><span class="app-badge">{member.active ? "Actief" : "Inactief"}</span> <span class="app-badge">{member.user_id ? "Gekoppeld account" : "Geen account"}</span></p>
          {member.user_id && <p>Account: {(() => { const account = data.accounts.find(item => item.user_id === member.user_id); return account ? maskedEmail(account.email) : "gekoppeld"; })()}</p>}
          {readRoles && member.user_id && <p>APP-rollen: Lid{data.assignments.filter(row => row.user_id === member.user_id && row.role_key !== "MEMBER").map(row => data.roles.find(role => role.key === row.role_key)?.label ?? row.role_key).length ? `, ${data.assignments.filter(row => row.user_id === member.user_id && row.role_key !== "MEMBER").map(row => data.roles.find(role => role.key === row.role_key)?.label ?? row.role_key).join(", ")}` : ""}</p>}
        </div>
        {manage && <div class="app-actions"><button class="btn btn-light" type="button" disabled={busy} onClick={() => setEditing(member)}>Bewerken</button>
          <button class="btn btn-light" type="button" disabled={busy} onClick={() => {
            if (window.confirm(`${member.first_name} ${member.last_name} ${member.active ? "archiveren" : "opnieuw activeren"} ? Deze actie wijzigt de APP-rollen niet.`)) {
              void mutate(async () => { await setMemberActive(client, member.id, !member.active); setEditing(undefined); }, member.active ? "Lid gearchiveerd." : "Lid opnieuw geactiveerd.");
            }
          }}>{member.active ? "Archiveren" : "Opnieuw activeren"}</button></div>}
      </li>)}</ul>
    </>}
    {!loading && !error && manageRoles && <AccountRoles key={revision} accounts={data.accounts} roles={data.roles} assignments={data.assignments} busy={busy} onSave={(id, roles) => mutate(() => saveAccountRoles(client, id, roles), "APP-rollen opgeslagen.")} />}
    {manage && manageRoles && <InviteAccount client={client} members={data.members} roles={data.roles} onInvited={reload} />}
  </section>;
}
