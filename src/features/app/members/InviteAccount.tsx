import { useState } from "preact/hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appError } from "../data";
import { requireOnline } from "../pwa/network";
import type { Member, AppRole, AppRoleKey } from "../types";

export default function InviteAccount({ client, members, roles, onInvited }: { client: SupabaseClient; members: Member[]; roles: AppRole[]; onInvited: () => Promise<void> }) {
  const [memberId, setMemberId] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<AppRoleKey[]>(["MEMBER"]);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function invite() {
    setBusy(true); setMessage(""); setFailed(false);
    try {
      requireOnline();
      const { data, error } = await client.auth.getSession();
      if (error || !data.session) throw new Error("Meld je opnieuw aan.");
      const response = await fetch("/api/app/invite", { method: "POST", headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}`
      }, body: JSON.stringify({ email, fullName, memberId, roles: selectedRoles }) });
      const result: { message: string; userId?: string } = await response.json();
      if (!response.ok || !result.userId) {
        if (result.userId) await onInvited();
        throw new Error(result.message);
      }
      setMessage(result.message);
      setEmail(""); setFullName(""); setMemberId(""); setSelectedRoles(["MEMBER"]);
      await onInvited();
    } catch (error) { setFailed(true); setMessage(appError(error)); }
    finally { setBusy(false); }
  }
  return <form class="admin-subpanel app-member-form" onSubmit={event => { event.preventDefault(); void invite(); }}>
    <h2>Account uitnodigen</h2>
    <p>Kies een bestaand lid zonder account. De uitnodiging koppelt het nieuwe account en kent de geselecteerde APP-rollen toe. De SITE-toegang blijft ongewijzigd.</p>
    <fieldset disabled={busy}><div class="app-member-fields">
      <label>Lid *<select required value={memberId} onChange={event => {
        const id = event.currentTarget.value; setMemberId(id);
        const member = members.find(item => item.id === id);
        setFullName(member ? `${member.first_name} ${member.last_name}` : "");
      }}><option value="">Kies een lid zonder account</option>{members.filter(member => !member.user_id).map(member => <option key={member.id} value={member.id}>{member.first_name} {member.last_name}{member.active ? "" : " (inactif)"}</option>)}</select></label>
      <label>Naam<input maxLength={120} value={fullName} onInput={event => setFullName(event.currentTarget.value)} /></label>
      <label>E-mail *<input type="email" required maxLength={254} value={email} onInput={event => setEmail(event.currentTarget.value)} /></label>
    </div><div class="app-role-options">{roles.map(role => <label class="app-check" key={role.key}><input type="checkbox" checked={selectedRoles.includes(role.key)} onChange={event => setSelectedRoles(event.currentTarget.checked ? [...selectedRoles, role.key] : selectedRoles.filter(key => key !== role.key))} />{role.label}</label>)}</div>
    <button class="btn" type="submit" disabled={!memberId || !selectedRoles.length}>{busy ? "Verzenden…" : "Uitnodigen en toegang geven"}</button></fieldset>
    {message && <p role={failed ? "alert" : "status"}>{message}</p>}
  </form>;
}
