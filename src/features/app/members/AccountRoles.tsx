import { useState } from "preact/hooks";
import type { AppAccount, AppRole, AppRoleKey, AppUserRole } from "../types";

interface Props {
  accounts: AppAccount[];
  roles: AppRole[];
  assignments: AppUserRole[];
  busy: boolean;
  onSave: (userId: string, roles: AppRoleKey[]) => Promise<void>;
}
export default function AccountRoles({ accounts, roles, assignments, busy, onSave }: Props) {
  const [userId, setUserId] = useState("");
  const [selected, setSelected] = useState<AppRoleKey[]>([]);
  return <form class="admin-subpanel app-member-form" onSubmit={event => {
    event.preventDefault();
    if (window.confirm("De APP-rollen van dit account vervangen? Zonder rol verliest het account APP-toegang. De SITE-rechten blijven afzonderlijk beheerd.")) void onSave(userId, selected);
  }}>
    <h2>APP-rollen van accounts</h2>
    <p>Ook een account zonder gekoppeld lid kan APP-rollen hebben.</p>
    <fieldset disabled={busy}>
      <label>Account<select required value={userId} onChange={event => {
        const id = event.currentTarget.value; setUserId(id);
        setSelected(assignments.filter(row => row.user_id === id).map(row => row.role_key));
      }}><option value="">Kies een account</option>{accounts.map(account => <option key={account.user_id} value={account.user_id}>{account.full_name || account.email} — {account.email}{account.member_id ? "" : " (zonder lid)"}</option>)}</select></label>
      {userId && <><div class="app-role-options">{roles.map(role => <label key={role.key} class="app-check"><input type="checkbox" checked={selected.includes(role.key)} onChange={event => setSelected(event.currentTarget.checked ? [...selected, role.key] : selected.filter(key => key !== role.key))} />{role.label}</label>)}</div>
        <button class="btn" type="submit">Rollen opslaan</button></>}
    </fieldset>
  </form>;
}
