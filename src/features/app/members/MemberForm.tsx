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
    <h2>{member ? "Lid bewerken" : "Nieuw lid"}</h2>
    <fieldset disabled={busy}>
      <h3>Identiteit</h3>
      <div class="app-member-fields">
        <label>Voornaam *<input required maxLength={100} value={draft.first_name} onInput={event => setDraft({ ...draft, first_name: event.currentTarget.value })} /></label>
        <label>Achternaam *<input required maxLength={100} value={draft.last_name} onInput={event => setDraft({ ...draft, last_name: event.currentTarget.value })} /></label>
        <label>Gekoppeld account (optioneel)<select value={draft.user_id ?? ""} onChange={event => setDraft({ ...draft, user_id: event.currentTarget.value || null })}>
          <option value="">Geen account</option>
          {accounts.filter(account => !account.member_id || account.member_id === member?.id).map(account => <option key={account.user_id} value={account.user_id}>{account.full_name || account.email_masked || "Account"} — {account.email_masked || "verborgen"}</option>)}
        </select></label>
      </div>
      <h3>Account</h3>
      <p class="muted">Een account koppelen verbindt de identiteit met dit lid. De APP-basistoegang komt van het account en vereist geen handmatige rol.</p>
      <h3>Status</h3>
      <label class="app-check"><input type="checkbox" checked={draft.active} onChange={event => setDraft({ ...draft, active: event.currentTarget.checked })} /> Actief lid</label>
      <p class="muted">Archiveren verwijdert geen account of extra APP-rollen.</p>
      <div class="app-actions"><button class="btn" type="submit">{busy ? "Opslaan…" : "Opslaan"}</button><button class="btn btn-light" type="button" onClick={onCancel}>Annuleren</button></div>
    </fieldset>
  </form>;
}
