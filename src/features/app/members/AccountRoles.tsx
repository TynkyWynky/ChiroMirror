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
    if (window.confirm("Remplacer les rôles APP de ce compte ? Sans rôle, il perd l’accès APP. Les droits SITE restent séparés.")) void onSave(userId, selected);
  }}>
    <h2>Rôles APP des comptes</h2>
    <p>Un compte sans membre lié peut aussi posséder des rôles APP.</p>
    <fieldset disabled={busy}>
      <label>Compte<select required value={userId} onChange={event => {
        const id = event.currentTarget.value; setUserId(id);
        setSelected(assignments.filter(row => row.user_id === id).map(row => row.role_key));
      }}><option value="">Choisissez un compte</option>{accounts.map(account => <option key={account.user_id} value={account.user_id}>{account.full_name || account.email} — {account.email}{account.member_id ? "" : " (sans membre)"}</option>)}</select></label>
      {userId && <><div class="app-role-options">{roles.map(role => <label key={role.key} class="app-check"><input type="checkbox" checked={selected.includes(role.key)} onChange={event => setSelected(event.currentTarget.checked ? [...selected, role.key] : selected.filter(key => key !== role.key))} />{role.label}</label>)}</div>
        <button class="btn" type="submit">Enregistrer les rôles</button></>}
    </fieldset>
  </form>;
}
