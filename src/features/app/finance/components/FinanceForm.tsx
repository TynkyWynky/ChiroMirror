import { useEffect, useRef, useState } from "preact/hooks";
import type { AppAccess } from "../../types";
import { MAX_DATE, MIN_DATE } from "../../events/dates";
import { ownEntity, treasuryManage } from "../access";
import { entityName, type FinanceData } from "../data";
import { makeFinanceDraft, validateFinance } from "../validation";
import { formatMoney, parseMoney } from "../money";
import { equalSplit } from "../splits";
import type { FinanceDraft, FinanceTransaction } from "../types";

export default function FinanceForm({ kind, transaction, data, access, busy, error, onSave, onClose }: {
  kind: FinanceDraft["kind"]; transaction?: FinanceTransaction; data: FinanceData; access: AppAccess; busy: boolean; error: string;
  onSave: (value: ReturnType<typeof validateFinance>) => Promise<void>; onClose: () => void;
}) {
  const own = ownEntity(data.entities, access), manager = treasuryManage(access);
  const [draft, setDraft] = useState(() => makeFinanceDraft(kind, own, transaction, data)), [invalid, setInvalid] = useState("");
  const title = useRef<HTMLInputElement>(null); useEffect(() => { title.current?.focus(); }, []);
  const change = <K extends keyof FinanceDraft>(key: K, value: FinanceDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const oldIds = transaction ? [transaction.paid_by_entity_id, transaction.debtor_entity_id, transaction.creditor_entity_id, ...data.shares.filter(s => s.transaction_id === transaction.id).map(s => s.entity_id)] : [];
  const entities = data.entities.filter(e => e.type === "CHIRO" ? manager && draft.visibility === "TREASURY" : data.members.some(m => m.id === e.member_id && (m.active || oldIds.includes(e.id))));
  let preview: { entity_id: string; amount_cents: bigint }[] = [];
  try { if (draft.kind === "EXPENSE" && draft.split === "EQUAL") preview = equalSplit(parseMoney(draft.amount), draft.shares.map(s => s.entity_id)); } catch { /* Preview follows valid amount/participants only. */ }
  const options = entities.map(e => <option key={e.id} value={e.id}>{entityName(e.id, data)}</option>);
  return <form class="admin-subpanel finance-form" onSubmit={e => {
    e.preventDefault(); setInvalid("");
    try { const value = validateFinance(draft, data, transaction); void onSave(value); } catch (cause) { setInvalid(cause instanceof Error ? cause.message : "Controleer de velden."); }
  }}>
    <h2>{transaction ? "Transactie bewerken" : kind === "EXPENSE" ? "Nieuwe gedeelde uitgave" : "Nieuwe schuld"}</h2>
    {(invalid || error) && <p role="alert" class="finance-error">{invalid || error}</p>}
    <fieldset disabled={busy}>
      <label>Reden *<input ref={title} required maxLength={200} value={draft.title} onInput={e => change("title", e.currentTarget.value)} /></label>
      <label>Beschrijving<textarea maxLength={10000} value={draft.description} onInput={e => change("description", e.currentTarget.value)} /></label>
      <div class="finance-fields"><label>Totaalbedrag (€) *<input required inputMode="decimal" value={draft.amount} onInput={e => change("amount", e.currentTarget.value)} /></label>
        <label>Datum *<input type="date" required min={MIN_DATE} max={MAX_DATE} value={draft.date} onInput={e => change("date", e.currentTarget.value)} /></label></div>
      {manager && <label>Zichtbaarheid<select aria-label="Zichtbaarheid" disabled={Boolean(transaction)} value={draft.visibility} onChange={e => setDraft(current => ({ ...current, visibility: e.currentTarget.value as FinanceDraft["visibility"], payer: own ?? "", debtor: own ?? "", creditor: "", shares: [] }))}>
        <option value="PRIVATE">Privé — betrokken personen</option><option value="TREASURY">Chirokas — met de Chiro</option>
      </select></label>}
      <p>{draft.visibility === "PRIVATE" ? "Alleen de betrokken personen kunnen deze transactie bekijken. Beheerders krijgen niet automatisch toegang." : "Zichtbaar voor de betrokken personen en Financiën. Terugbetalingen worden via Financiën geregistreerd."}</p>
      {kind === "DIRECT_DEBT" ? <div class="finance-fields">
        <label>Wie is geld verschuldigd? *<select aria-label="Wie is geld verschuldigd?" required value={draft.debtor} onChange={e => change("debtor", e.currentTarget.value)}><option value="">Kiezen</option>{options}</select></label>
        <label>Aan wie? *<select aria-label="Aan wie?" required value={draft.creditor} onChange={e => change("creditor", e.currentTarget.value)}><option value="">Kiezen</option>{options}</select></label>
      </div> : <>
        <label>Betaald door *<select aria-label="Betaald door" required value={draft.payer} onChange={e => change("payer", e.currentTarget.value)}><option value="">Kiezen</option>{entities.filter(e => draft.visibility === "TREASURY" || e.id === own).map(e => <option key={e.id} value={e.id}>{entityName(e.id, data)}</option>)}</select></label>
        <label>Verdeling<select aria-label="Verdeling" value={draft.split} onChange={e => change("split", e.currentTarget.value as FinanceDraft["split"])}><option value="EQUAL">Gelijk</option><option value="CUSTOM_AMOUNT">Aangepaste bedragen</option></select></label>
        <fieldset class="finance-picker"><legend>Deelnemers — vink ook de betaler aan als die deelneemt</legend>
          {entities.map(entity => { const share = draft.shares.find(s => s.entity_id === entity.id); return <div class="finance-share" key={entity.id}>
            <label class="finance-checkbox"><input type="checkbox" checked={Boolean(share)} onChange={e => change("shares", e.currentTarget.checked ? [...draft.shares, { entity_id: entity.id, amount: "" }] : draft.shares.filter(s => s.entity_id !== entity.id))} />{entityName(entity.id, data)}</label>
            {share && draft.split === "CUSTOM_AMOUNT" && <label>Aandeel van {entityName(entity.id, data)} (€)<input required inputMode="decimal" value={share.amount} onInput={e => change("shares", draft.shares.map(s => s.entity_id === entity.id ? { ...s, amount: e.currentTarget.value } : s))} /></label>}
            {share && draft.split === "EQUAL" && preview.some(s => s.entity_id === entity.id) && <span>{formatMoney(preview.find(s => s.entity_id === entity.id)!.amount_cents)}</span>}
          </div>; })}
        </fieldset>
        <p class="muted">De resterende centen worden in een vaste volgorde verdeeld. Bij heel kleine bedragen kan een aandeel € 0,00 zijn.</p>
      </>}
      <div class="finance-actions"><button class="btn" type="submit">{busy ? "Opslaan…" : "Opslaan"}</button><button class="btn btn-light" type="button" onClick={onClose}>Sluiten zonder op te slaan</button></div>
    </fieldset>
  </form>;
}
