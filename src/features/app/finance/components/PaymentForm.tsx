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
      if (!selected || !amounts) throw new Error("Kies een schuld om terug te betalen.");
      const value = parseMoney(amount);
      if (value > amounts.remaining) throw new Error(`Het bedrag is hoger dan het resterende saldo van ${formatMoney(amounts.remaining)}.`);
      void onSave(selected, { amount_cents: value.toString(), payment_date: date, comment: comment.trim() || null });
    } catch (cause) { setInvalid(cause instanceof Error ? cause.message : "Controleer het bedrag."); }
  }}>
    <h2>Terugbetaling registreren</h2>
    <p>Registreer een betaling die al is uitgevoerd. Deze actie maakt geen geld over.</p>
    {(invalid || error) && <p role="alert" class="finance-error">{invalid || error}</p>}
    <fieldset disabled={busy}>
      <label>Terug te betalen schuld<select aria-label="Terug te betalen schuld" required value={id} onChange={e => { setId(e.currentTarget.value); setAmount(""); }}><option value="">Kies een schuld</option>{available.map(o => <option value={o.id} key={o.id}>{data.transactions.find(t => t.id === o.transaction_id)?.title} — {entityName(o.debtor_entity_id, data)} → {entityName(o.creditor_entity_id, data)} — {formatMoney(obligationAmounts(o, data).remaining)}</option>)}</select></label>
      {amounts && <div class="finance-amounts"><p>Oorspronkelijke schuld: <strong>{formatMoney(amounts.original)}</strong></p><p>Al terugbetaald: <strong>{formatMoney(amounts.paid)}</strong></p><p>Resterend: <strong>{formatMoney(amounts.remaining)}</strong></p></div>}
      {!available.length && <p>Geen openstaande schuld die je kunt terugbetalen. Chirobetalingen zijn voorbehouden aan de penningmeester.</p>}
      <label>Bedrag van de terugbetaling (€) *<input autoFocus required inputMode="decimal" value={amount} onInput={e => setAmount(e.currentTarget.value)} /></label>
      {amounts && <button class="btn btn-light" type="button" onClick={() => setAmount(moneyInput(amounts.remaining))}>Volledig resterend bedrag</button>}
      <label>Betaaldatum *<input type="date" required min={MIN_DATE} max={MAX_DATE} value={date} onInput={e => setDate(e.currentTarget.value)} /></label>
      <label>Opmerking<textarea maxLength={2000} value={comment} onInput={e => setComment(e.currentTarget.value)} /></label>
      <div class="finance-actions"><button class="btn" type="submit" disabled={!selected}>Terugbetaling opslaan</button><button class="btn btn-light" type="button" onClick={onClose}>Sluiten zonder op te slaan</button></div>
    </fieldset>
  </form>;
}
