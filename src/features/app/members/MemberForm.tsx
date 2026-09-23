import { useState } from "preact/hooks";
import type { AppAccount, Member, MemberInput } from "../types";

interface Props {
  member: Member | null;
  accounts: AppAccount[];
  busy: boolean;
  onSave: (input: MemberInput) => Promise<void>;
  onCancel: () => void;
}

// Declared at module scope: typing never remounts fields or loses keyboard focus.
export default function MemberForm({ member, accounts, busy, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<MemberInput>(() => ({
    first_name: member?.first_name ?? "", last_name: member?.last_name ?? "",
    user_id: member?.user_id ?? null, active: member?.active ?? true
  }));
  return <form class="admin-subpanel app-member-form" onSubmit={event => { event.preventDefault(); void onSave(draft); }}>
    <h2>{member ? "Modifier le membre" : "Nouveau membre"}</h2>
    <fieldset disabled={busy}>
      <div class="app-member-fields">
        <label>Prénom *<input required maxLength={100} value={draft.first_name} onInput={event => setDraft({ ...draft, first_name: event.currentTarget.value })} /></label>
        <label>Nom *<input required maxLength={100} value={draft.last_name} onInput={event => setDraft({ ...draft, last_name: event.currentTarget.value })} /></label>
        <label>Compte lié (facultatif)<select value={draft.user_id ?? ""} onChange={event => setDraft({ ...draft, user_id: event.currentTarget.value || null })}>
          <option value="">Aucun compte</option>
          {accounts.filter(account => !account.member_id || account.member_id === member?.id).map(account => <option key={account.user_id} value={account.user_id}>{account.full_name || account.email} — {account.email}</option>)}
        </select></label>
      </div>
      <label class="app-check"><input type="checkbox" checked={draft.active} onChange={event => setDraft({ ...draft, active: event.currentTarget.checked })} /> Membre actif</label>
      <p class="muted">Lier un compte n’attribue aucun rôle APP. L’archivage ne révoque pas les accès.</p>
      <div class="app-actions"><button class="btn" type="submit">{busy ? "Enregistrer…" : "Enregistrer"}</button><button class="btn btn-light" type="button" onClick={onCancel}>Annuler</button></div>
    </fieldset>
  </form>;
}
