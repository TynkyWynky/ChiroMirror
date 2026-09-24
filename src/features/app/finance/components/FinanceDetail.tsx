import { useEffect, useRef, useState } from "preact/hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppAccess } from "../../types";
import { formatDay, formatTime, instantToLocal } from "../../events/dates";
import { canManage, canRecord, ownEntity } from "../access";
import { obligationAmounts } from "../balances";
import { actorName, entityName, financeError, loadActivity, type FinanceData } from "../data";
import { formatMoney } from "../money";
import type { FinanceActivity, FinanceTransaction } from "../types";
const actions: Record<string, string> = { EXPENSE_CREATED: "Uitgave aangemaakt", DIRECT_DEBT_CREATED: "Schuld aangemaakt", TRANSACTION_UPDATED: "Transactie aangepast vóór terugbetaling", TRANSACTION_CANCELLED: "Transactie geannuleerd", PAYMENT_RECORDED: "Terugbetaling geregistreerd", PAYMENT_CANCELLED: "Terugbetaling geannuleerd" };
export default function FinanceDetail({ transaction: tx, data, access, userId, client, busy, onEdit, onPay, onCancel, onClose }: {
  transaction: FinanceTransaction; data: FinanceData; access: AppAccess; userId: string; client: SupabaseClient; busy: boolean;
  onEdit: () => void; onPay: (id: string) => void; onCancel: (kind: "payment" | "transaction", id: string, reason: string) => Promise<boolean>; onClose: () => void;
}) {
  const own = ownEntity(data.entities, access), manage = canManage(tx, access, userId);
  const payments = data.payments.filter(p => p.transaction_id === tx.id), obligations = data.obligations.filter(o => o.transaction_id === tx.id);
  const [activity, setActivity] = useState<FinanceActivity[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
  const [cancelling, setCancelling] = useState<{ kind: "payment" | "transaction"; id: string } | null>(null), [reason, setReason] = useState("");
  const title = useRef<HTMLHeadingElement>(null); useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError("");
    loadActivity(client, tx.id).then(rows => { if (active) setActivity(rows); }).catch(cause => { if (active) setError(financeError(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, tx.id, tx.revision, attempt]);
  return <section class="admin-subpanel finance-detail">
    <h2 ref={title} tabIndex={-1}>{tx.title}</h2>
    <p><strong>{formatMoney(tx.amount_cents)}</strong> · {formatDay(tx.expense_date)} · {tx.visibility === "PRIVATE" ? "Privé" : "Chirokas"}{tx.status === "CANCELLED" ? " · Geannuleerd" : ""}</p>
    {tx.description && <p class="finance-description">{tx.description}</p>}
    {tx.kind === "DIRECT_DEBT" ? <p>{entityName(tx.debtor_entity_id, data)} is verschuldigd aan {entityName(tx.creditor_entity_id, data)}</p> : <>
      <p>Betaald door {entityName(tx.paid_by_entity_id, data)} · Verdeling {tx.split_mode === "EQUAL" ? "gelijk" : "aangepast"}</p>
      <h3>Aandelen van de uitgave</h3><ul class="finance-list">{data.shares.filter(s => s.transaction_id === tx.id).map(s => <li key={s.entity_id}>{entityName(s.entity_id, data)} : <strong>{formatMoney(s.amount_cents)}</strong>{s.entity_id === tx.paid_by_entity_id ? " · aandeel van de betaler, zonder schuld aan zichzelf" : ""}</li>)}</ul>
    </>}
    <h3>Schulden</h3>
    {!obligations.length && <p>Geen schuld aan een andere persoon voor deze uitgave.</p>}
    <ul class="finance-list">{obligations.map(o => { const values = obligationAmounts(o, data); return <li class="finance-obligation" key={o.id}>
      <strong>{entityName(o.debtor_entity_id, data)} → {entityName(o.creditor_entity_id, data)}</strong>
      <p>Oorspronkelijk: {formatMoney(values.original)} · Terugbetaald: {formatMoney(values.paid)}</p>
      <p>Resterend: <strong>{formatMoney(values.remaining)}</strong>{values.cancelled ? " · Geannuleerd" : values.remaining === 0n ? " · Vereffend" : ""}</p>
      {values.remaining > 0n && canRecord(tx, o, access, own) && <button class="btn btn-light" type="button" disabled={busy} onClick={() => onPay(o.id)}>Deze schuld terugbetalen</button>}
    </li>; })}</ul>
    <h3>Terugbetalingen</h3>
    {!payments.length && <p>Geen terugbetalingen geregistreerd.</p>}
    <ul class="finance-list">{payments.map(p => <li class="finance-obligation" key={p.id}>
      <p>{entityName(p.from_entity_id, data)} → {entityName(p.to_entity_id, data)} : <strong>{formatMoney(p.amount_cents)}</strong> · {formatDay(p.payment_date)}</p>
      <p>Geregistreerd door {actorName(p.created_by, data, userId)}{p.status === "CANCELLED" ? ` · Geannuleerd: ${p.cancellation_reason}` : ""}</p>{p.comment && <p class="finance-description">{p.comment}</p>}
      {p.status === "ACTIVE" && canRecord(tx, p, access, own) && <button class="btn btn-light" disabled={busy} type="button" onClick={() => { setCancelling({ kind: "payment", id: p.id }); setReason(""); }}>Deze terugbetaling annuleren</button>}
    </li>)}</ul>
    {cancelling && <form class="finance-form" onSubmit={e => { e.preventDefault(); void onCancel(cancelling.kind, cancelling.id, reason).then(saved => { if (saved) { setCancelling(null); setReason(""); } }); }}>
      <fieldset disabled={busy}><legend>Annulering bevestigen {cancelling.kind === "payment" ? "van de terugbetaling" : "van de transactie"}</legend>
        <p>{cancelling.kind === "payment" ? "Het openstaande bedrag wordt hoger. De betaling blijft in de geschiedenis bewaard." : "De schulden tellen niet meer mee in de saldi. De geschiedenis blijft bewaard."}</p>
        <label>Reden voor annulering *<textarea autoFocus required maxLength={2000} value={reason} onInput={e => setReason(e.currentTarget.value)} /></label>
        <div class="finance-actions"><button class="btn" type="submit">Annulering bevestigen</button><button class="btn btn-light" type="button" onClick={() => setCancelling(null)}>Behouden</button></div>
      </fieldset>
    </form>}
    <div class="finance-actions">
      {manage && tx.status === "ACTIVE" && !payments.length && <button class="btn" disabled={busy} type="button" onClick={onEdit}>Bewerken</button>}
      {manage && tx.status === "ACTIVE" && !payments.some(p => p.status === "ACTIVE") && <button class="btn btn-light" disabled={busy} type="button" onClick={() => { setCancelling({ kind: "transaction", id: tx.id }); setReason(""); }}>Transactie annuleren</button>}
      <button class="btn btn-light" disabled={busy} type="button" onClick={onClose}>Details sluiten</button>
    </div>
    {manage && payments.length > 0 && <p>Deze transactie heeft terugbetalingen en kan niet worden bewerkt. Annuleer bij een fout eerst de betrokken terugbetalingen en daarna de transactie. Maak vervolgens een vervangende transactie aan.</p>}
    <h3>Transactiegeschiedenis</h3>
    {loading ? <p role="status">Geschiedenis laden…</p> : error ? <p role="alert">{error} <button type="button" onClick={() => setAttempt(n => n + 1)}>Opnieuw proberen</button></p> : <ol class="finance-audit">{activity.map(a => <li key={a.id}>
      <strong>{actions[a.action] ?? a.action}</strong> · {actorName(a.actor_id, data, userId)} · {formatDay(instantToLocal(a.created_at).slice(0, 10), false)} om {formatTime(a.created_at)}
      {a.metadata.amount_cents && <span> · {formatMoney(a.metadata.amount_cents)}</span>}{a.metadata.before_amount_cents && a.metadata.after_amount_cents && <span> · {formatMoney(a.metadata.before_amount_cents)} → {formatMoney(a.metadata.after_amount_cents)}</span>}
      {a.metadata.reason && <p>{a.metadata.reason}</p>}
    </li>)}</ol>}
    <p class="muted">De laatste 100 acties worden getoond. Privébetalingen worden door een van beide partijen geregistreerd, zonder wederzijdse bevestiging in deze versie.</p>
  </section>;
}
