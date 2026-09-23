import { useState } from "preact/hooks";
import type { AppAccess } from "../../types";
import { MIN_DATE, MAX_DATE, today } from "../../events/dates";
import { canRecord, ownEntity } from "../access";
import { obligationAmounts } from "../balances";
import { entityName, type FinanceData } from "../data";
import { formatMoney, moneyInput, parseMoney } from "../money";
import type { Obligation } from "../types";
export default function PaymentForm({ data, access, initialId, busy, error, onSave, onClose }: {
  data: FinanceData; access: AppAccess; initialId?: string; busy: boolean; error: string;
  onSave: (obligation: Obligation, details: { amount_cents: string; payment_date: string; comment: string | null }) => Promise<void>; onClose: () => void;
}) {
  const [id, setId] = useState(initialId ?? ""), [amount, setAmount] = useState(""), [date, setDate] = useState(today), [comment, setComment] = useState(""), [invalid, setInvalid] = useState("");
  const own = ownEntity(data.entities, access);
  const available = data.obligations.filter(o => {
    const transaction = data.transactions.find(t => t.id === o.transaction_id);
    return transaction?.status === "ACTIVE" && canRecord(transaction, o, access, own) && obligationAmounts(o, data).remaining > 0n;
  });
  const selected = available.find(o => o.id === id), amounts = selected ? obligationAmounts(selected, data) : null;
  return <form class="admin-subpanel finance-form" onSubmit={e => {
    e.preventDefault(); setInvalid("");
    try {
      if (!selected || !amounts) throw new Error("Choisissez une dette à rembourser.");
      const value = parseMoney(amount);
      if (value > amounts.remaining) throw new Error(`Le montant dépasse le solde restant de ${formatMoney(amounts.remaining)}.`);
      void onSave(selected, { amount_cents: value.toString(), payment_date: date, comment: comment.trim() || null });
    } catch (cause) { setInvalid(cause instanceof Error ? cause.message : "Vérifiez le montant."); }
  }}>
    <h2>Enregistrer un remboursement</h2>
    <p>Enregistrez un paiement déjà effectué. Cette action ne transfère pas d’argent.</p>
    {(invalid || error) && <p role="alert" class="finance-error">{invalid || error}</p>}
    <fieldset disabled={busy}>
      <label>Dette à rembourser<select aria-label="Dette à rembourser" required value={id} onChange={e => { setId(e.currentTarget.value); setAmount(""); }}><option value="">Choisir une dette</option>{available.map(o => <option value={o.id} key={o.id}>{data.transactions.find(t => t.id === o.transaction_id)?.title} — {entityName(o.debtor_entity_id, data)} → {entityName(o.creditor_entity_id, data)} — {formatMoney(obligationAmounts(o, data).remaining)}</option>)}</select></label>
      {amounts && <div class="finance-amounts"><p>Dette originale : <strong>{formatMoney(amounts.original)}</strong></p><p>Déjà remboursé : <strong>{formatMoney(amounts.paid)}</strong></p><p>Restant : <strong>{formatMoney(amounts.remaining)}</strong></p></div>}
      {!available.length && <p>Aucune dette ouverte que vous puissiez rembourser. Les paiements Chiro sont réservés à la trésorerie.</p>}
      <label>Montant du remboursement (€) *<input autoFocus required inputMode="decimal" value={amount} onInput={e => setAmount(e.currentTarget.value)} /></label>
      {amounts && <button class="btn btn-light" type="button" onClick={() => setAmount(moneyInput(amounts.remaining))}>Tout le restant</button>}
      <label>Date du paiement *<input type="date" required min={MIN_DATE} max={MAX_DATE} value={date} onInput={e => setDate(e.currentTarget.value)} /></label>
      <label>Commentaire<textarea maxLength={2000} value={comment} onInput={e => setComment(e.currentTarget.value)} /></label>
      <div class="finance-actions"><button class="btn" type="submit" disabled={!selected}>Enregistrer le remboursement</button><button class="btn btn-light" type="button" onClick={onClose}>Fermer sans enregistrer</button></div>
    </fieldset>
  </form>;
}
