import { useEffect, useRef, useState } from "preact/hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppAccess } from "../../types";
import { formatDay, formatTime, instantToLocal } from "../../events/dates";
import { canManage, canRecord, ownEntity } from "../access";
import { obligationAmounts } from "../balances";
import { actorName, entityName, financeError, loadActivity, type FinanceData } from "../data";
import { formatMoney } from "../money";
import type { FinanceActivity, FinanceTransaction } from "../types";
const actions: Record<string, string> = { EXPENSE_CREATED: "Dépense créée", DIRECT_DEBT_CREATED: "Dette créée", TRANSACTION_UPDATED: "Opération corrigée avant remboursement", TRANSACTION_CANCELLED: "Opération annulée", PAYMENT_RECORDED: "Remboursement enregistré", PAYMENT_CANCELLED: "Remboursement annulé" };
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
    <p><strong>{formatMoney(tx.amount_cents)}</strong> · {formatDay(tx.expense_date)} · {tx.visibility === "PRIVATE" ? "Privée" : "Trésorerie"}{tx.status === "CANCELLED" ? " · Annulée" : ""}</p>
    {tx.description && <p class="finance-description">{tx.description}</p>}
    {tx.kind === "DIRECT_DEBT" ? <p>{entityName(tx.debtor_entity_id, data)} doit à {entityName(tx.creditor_entity_id, data)}</p> : <>
      <p>Payé par {entityName(tx.paid_by_entity_id, data)} · Répartition {tx.split_mode === "EQUAL" ? "égale" : "personnalisée"}</p>
      <h3>Parts de la dépense</h3><ul class="finance-list">{data.shares.filter(s => s.transaction_id === tx.id).map(s => <li key={s.entity_id}>{entityName(s.entity_id, data)} : <strong>{formatMoney(s.amount_cents)}</strong>{s.entity_id === tx.paid_by_entity_id ? " · part du payeur, sans dette envers lui-même" : ""}</li>)}</ul>
    </>}
    <h3>Obligations</h3>
    {!obligations.length && <p>Aucune dette envers une autre personne pour cette dépense.</p>}
    <ul class="finance-list">{obligations.map(o => { const values = obligationAmounts(o, data); return <li class="finance-obligation" key={o.id}>
      <strong>{entityName(o.debtor_entity_id, data)} → {entityName(o.creditor_entity_id, data)}</strong>
      <p>Original : {formatMoney(values.original)} · Remboursé : {formatMoney(values.paid)}</p>
      <p>Restant : <strong>{formatMoney(values.remaining)}</strong>{values.cancelled ? " · Annulée" : values.remaining === 0n ? " · Soldée" : ""}</p>
      {values.remaining > 0n && canRecord(tx, o, access, own) && <button class="btn btn-light" type="button" disabled={busy} onClick={() => onPay(o.id)}>Rembourser cette dette</button>}
    </li>; })}</ul>
    <h3>Remboursements</h3>
    {!payments.length && <p>Aucun remboursement enregistré.</p>}
    <ul class="finance-list">{payments.map(p => <li class="finance-obligation" key={p.id}>
      <p>{entityName(p.from_entity_id, data)} → {entityName(p.to_entity_id, data)} : <strong>{formatMoney(p.amount_cents)}</strong> · {formatDay(p.payment_date)}</p>
      <p>Enregistré par {actorName(p.created_by, data, userId)}{p.status === "CANCELLED" ? ` · Annulé : ${p.cancellation_reason}` : ""}</p>{p.comment && <p class="finance-description">{p.comment}</p>}
      {p.status === "ACTIVE" && canRecord(tx, p, access, own) && <button class="btn btn-light" disabled={busy} type="button" onClick={() => { setCancelling({ kind: "payment", id: p.id }); setReason(""); }}>Annuler ce remboursement</button>}
    </li>)}</ul>
    {cancelling && <form class="finance-form" onSubmit={e => { e.preventDefault(); void onCancel(cancelling.kind, cancelling.id, reason).then(saved => { if (saved) { setCancelling(null); setReason(""); } }); }}>
      <fieldset disabled={busy}><legend>Confirmer l’annulation {cancelling.kind === "payment" ? "du remboursement" : "de l’opération"}</legend>
        <p>{cancelling.kind === "payment" ? "Le restant dû augmentera. L’enregistrement du paiement restera dans l’historique." : "Les obligations ne compteront plus dans les soldes. L’historique sera conservé."}</p>
        <label>Motif d’annulation *<textarea autoFocus required maxLength={2000} value={reason} onInput={e => setReason(e.currentTarget.value)} /></label>
        <div class="finance-actions"><button class="btn" type="submit">Confirmer l’annulation</button><button class="btn btn-light" type="button" onClick={() => setCancelling(null)}>Conserver</button></div>
      </fieldset>
    </form>}
    <div class="finance-actions">
      {manage && tx.status === "ACTIVE" && !payments.length && <button class="btn" disabled={busy} type="button" onClick={onEdit}>Modifier</button>}
      {manage && tx.status === "ACTIVE" && !payments.some(p => p.status === "ACTIVE") && <button class="btn btn-light" disabled={busy} type="button" onClick={() => { setCancelling({ kind: "transaction", id: tx.id }); setReason(""); }}>Annuler l’opération</button>}
      <button class="btn btn-light" disabled={busy} type="button" onClick={onClose}>Fermer la fiche</button>
    </div>
    {manage && payments.length > 0 && <p>Cette opération possède un historique de remboursements : sa modification est bloquée. Pour corriger une saisie erronée, annulez explicitement les remboursements concernés, puis l’opération et créez son remplacement.</p>}
    <h3>Historique de l’opération</h3>
    {loading ? <p role="status">Chargement de l’historique…</p> : error ? <p role="alert">{error} <button type="button" onClick={() => setAttempt(n => n + 1)}>Réessayer</button></p> : <ol class="finance-audit">{activity.map(a => <li key={a.id}>
      <strong>{actions[a.action] ?? a.action}</strong> · {actorName(a.actor_id, data, userId)} · {formatDay(instantToLocal(a.created_at).slice(0, 10), false)} à {formatTime(a.created_at)}
      {a.metadata.amount_cents && <span> · {formatMoney(a.metadata.amount_cents)}</span>}{a.metadata.before_amount_cents && a.metadata.after_amount_cents && <span> · {formatMoney(a.metadata.before_amount_cents)} → {formatMoney(a.metadata.after_amount_cents)}</span>}
      {a.metadata.reason && <p>{a.metadata.reason}</p>}
    </li>)}</ol>}
    <p class="muted">100 dernières actions affichées. Les paiements privés sont déclarés par l’une des deux parties, sans validation mutuelle dans cette version.</p>
  </section>;
}
