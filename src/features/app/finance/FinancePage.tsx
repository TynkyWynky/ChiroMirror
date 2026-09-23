import { useEffect, useRef, useState } from "preact/hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppAccess } from "../types";
import { formatDay } from "../events/dates";
import { canRecord, ownEntity, treasuryManage } from "./access";
import { entityBalances, obligationAmounts } from "./balances";
import { emptyFinance, entityName, financeError, financeRpc, loadFinance, type FinanceData } from "./data";
import { formatMoney } from "./money";
import type { FinanceDraft, FinanceTransaction } from "./types";
import FinanceForm from "./components/FinanceForm";
import PaymentForm from "./components/PaymentForm";
import FinanceDetail from "./components/FinanceDetail";
import "./finance.css";

export default function FinancePage({ client, access, userId }: { client: SupabaseClient; access: AppAccess; userId: string }) {
  const [data, setData] = useState<FinanceData>(emptyFinance), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [feedback, setFeedback] = useState(""), [view, setView] = useState("mine"), [filter, setFilter] = useState("OPEN"), [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null), [editing, setEditing] = useState<{ kind: FinanceDraft["kind"]; transaction?: FinanceTransaction } | null>(null);
  const [paying, setPaying] = useState<{ id?: string } | null>(null);
  const request = useRef(0), returnFocus = useRef<HTMLElement | null>(null);
  const own = ownEntity(data.entities, access), manager = treasuryManage(access);
  const treasury = manager || access.permissions.includes("finance.treasury.read");
  const balanceEntity = view === "treasury" ? data.entities.find(e => e.type === "CHIRO")?.id : own;
  const balances = entityBalances(balanceEntity, data);
  const selectedTx = data.transactions.find(t => t.id === selected);
  const canCreate = Boolean(access.member?.active && own) || manager;
  const canPay = data.obligations.some(o => { const t = data.transactions.find(t => t.id === o.transaction_id); return t?.status === "ACTIVE" && canRecord(t, o, access, own) && obligationAmounts(o, data).remaining > 0n; });
  async function reload() {
    const current = ++request.current; setLoading(true); setError("");
    try { const next = await loadFinance(client); if (current === request.current) setData(next); }
    catch (cause) { if (current === request.current) { setData(emptyFinance); setError(financeError(cause)); } }
    finally { if (current === request.current) setLoading(false); }
  }
  useEffect(() => { void reload(); return () => { request.current++; }; }, [client, access]);
  function rememberFocus() { returnFocus.current = document.activeElement as HTMLElement; setError(""); setFeedback(""); }
  function close() { setSelected(null); setEditing(null); setPaying(null); setError(""); requestAnimationFrame(() => returnFocus.current?.isConnected && returnFocus.current.focus()); }
  async function mutate(action: () => Promise<void>, message: string, closeForm = false) {
    if (busy) return false;
    setBusy(true); setError(""); setFeedback("");
    try { await action(); if (closeForm) { setEditing(null); setPaying(null); } setFeedback(message); await reload(); return true; }
    catch (cause) { setError(financeError(cause)); return false; }
    finally { setBusy(false); }
  }
  const visible = data.transactions.filter(t => {
    const obligations = data.obligations.filter(o => o.transaction_id === t.id), settled = obligations.every(o => obligationAmounts(o, data).remaining === 0n);
    const involved = t.paid_by_entity_id === own || t.debtor_entity_id === own || t.creditor_entity_id === own || data.shares.some(s => s.transaction_id === t.id && s.entity_id === own);
    if (view === "mine" && !involved || view === "treasury" && (!treasury || t.visibility !== "TREASURY")) return false;
    if (filter === "OPEN" && (t.status !== "ACTIVE" || settled) || filter === "SETTLED" && (t.status !== "ACTIVE" || !settled) || filter === "CANCELLED" && t.status !== "CANCELLED") return false;
    if (filter === "PAYABLE" && !obligations.some(o => o.debtor_entity_id === balanceEntity && obligationAmounts(o, data).remaining > 0n)
      || filter === "RECEIVABLE" && !obligations.some(o => o.creditor_entity_id === balanceEntity && obligationAmounts(o, data).remaining > 0n)) return false;
    if (filter === "PRIVATE" && t.visibility !== "PRIVATE" || filter === "TREASURY" && t.visibility !== "TREASURY") return false;
    return `${t.title} ${t.description ?? ""}`.toLocaleLowerCase("fr").includes(search.trim().toLocaleLowerCase("fr"));
  });
  return <section class="admin-panel finance" lang="fr" aria-busy={busy || loading}>
    <header class="admin-page-heading"><div><p class="admin-eyebrow">APP</p><h1>Comptes</h1><p>Dettes, dépenses partagées et remboursements internes · EUR.</p></div></header>
    {feedback && <p role="status" class="finance-feedback">{feedback}</p>}
    {error && !editing && !paying && <p role="alert" class="finance-error">{error} <button class="btn btn-light" type="button" disabled={busy} onClick={() => void reload()}>Actualiser les comptes</button></p>}
    {editing ? <FinanceForm key={editing.transaction?.id ?? editing.kind} {...editing} data={data} access={access} busy={busy} error={error} onClose={close}
      onSave={async values => { await mutate(() => financeRpc(client, "save_app_finance", { target_id: editing.transaction?.id ?? null, expected_revision: editing.transaction?.revision ?? null, ...values }), "Opération enregistrée.", true); }} />
      : paying ? <PaymentForm data={data} access={access} initialId={paying.id} busy={busy} error={error} onClose={close} onSave={async (o, details) => {
        const tx = data.transactions.find(t => t.id === o.transaction_id)!;
        await mutate(() => financeRpc(client, "record_app_finance_payment", { obligation_id: o.id, expected_revision: tx.revision, details }), "Remboursement enregistré.", true);
      }} />
      : selectedTx ? <FinanceDetail key={selectedTx.id} transaction={selectedTx} data={data} access={access} userId={userId} client={client} busy={busy} onClose={close}
        onEdit={() => setEditing({ kind: selectedTx.kind, transaction: selectedTx })} onPay={id => setPaying({ id })}
        onCancel={(kind, id, reason) => mutate(() => financeRpc(client, kind === "payment" ? "cancel_app_finance_payment" : "cancel_app_finance_transaction", { target_id: id, expected_revision: selectedTx.revision, reason }), "Annulation enregistrée ; historique conservé.")} />
      : <>
        <div class="finance-actions" role="group" aria-label="Vue des comptes">{[["mine", "Mes comptes"], ...(treasury ? [["treasury", "Trésorerie"]] : []), ["history", "Historique"]].map(([key, label]) => <button key={key} class="btn btn-light" aria-pressed={view === key} type="button" onClick={() => { setView(key); setFilter(key === "history" ? "ALL" : "OPEN"); }}>{label}</button>)}</div>
        {loading ? <p role="status">Chargement des comptes…</p> : !error && <>
          {!own && <p>Votre compte n’est pas lié à un membre. Les comptes personnels seront disponibles après cette liaison.</p>}
          <div class="finance-balances" aria-label={view === "treasury" ? "Soldes de la Chiro" : "Soldes personnels"}>
            <div class="admin-subpanel"><h2>À payer{view === "treasury" ? " par la Chiro" : ""}</h2><strong class="finance-total" data-testid="payable">{formatMoney(balances.payable)}</strong></div>
            <div class="admin-subpanel"><h2>À recevoir{view === "treasury" ? " pour la Chiro" : ""}</h2><strong class="finance-total" data-testid="receivable">{formatMoney(balances.receivable)}</strong></div>
          </div>
          <div class="finance-actions">
            <button class="btn" disabled={!canCreate || busy} type="button" onClick={() => { rememberFocus(); setEditing({ kind: "EXPENSE" }); }}>+ Nouvelle dépense</button>
            <button class="btn" disabled={!canCreate || busy} type="button" onClick={() => { rememberFocus(); setEditing({ kind: "DIRECT_DEBT" }); }}>+ Nouvelle dette</button>
            <button class="btn btn-light" disabled={!canPay || busy} type="button" onClick={() => { rememberFocus(); setPaying({}); }}>+ Remboursement</button>
          </div>
          <ul class="finance-list finance-counterparties">{[...balances.counterparties].filter(([, totals]) => totals.payable > 0n || totals.receivable > 0n).map(([id, totals]) => <li key={id} class="admin-subpanel"><strong>{entityName(id, data)}</strong>
            {totals.payable > 0n && <p>{view === "treasury" ? "La Chiro doit payer" : "Vous devez payer"} : {formatMoney(totals.payable)}</p>}
            {totals.receivable > 0n && <p>{view === "treasury" ? "La Chiro doit recevoir" : "Vous devez recevoir"} : {formatMoney(totals.receivable)}</p>}
          </li>)}</ul>
          <div class="finance-fields"><label>Rechercher une opération<input type="search" value={search} onInput={e => setSearch(e.currentTarget.value)} /></label>
            <label>Filtrer les opérations<select aria-label="Filtrer les opérations" value={filter} onChange={e => setFilter(e.currentTarget.value)}>{[["OPEN", "Restant à régler"], ["ALL", "Toutes"], ["PAYABLE", "À payer"], ["RECEIVABLE", "À recevoir"], ["SETTLED", "Soldées"], ["TREASURY", "Chiro"], ["PRIVATE", "Privées"], ["CANCELLED", "Annulées"]].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          </div>
          <button class="btn btn-light" type="button" disabled={busy} onClick={() => void reload()}>Actualiser les comptes</button>
          {!visible.length && <p>Aucune opération pour cette vue.</p>}
          <ul class="finance-list">{visible.map(t => {
            const remaining = data.obligations.filter(o => o.transaction_id === t.id).reduce((sum, o) => sum + obligationAmounts(o, data).remaining, 0n);
            return <li class="admin-subpanel finance-card" key={t.id}>
              <p class="finance-tags">{t.visibility === "PRIVATE" ? "Privée" : "Trésorerie"} · {t.status === "CANCELLED" ? "Annulée" : remaining === 0n ? "Soldée" : "À régler"}</p>
              <h2><button class="finance-title" type="button" onClick={() => { rememberFocus(); setSelected(t.id); }}>{t.title}</button></h2>
              <p>{t.kind === "DIRECT_DEBT" ? `${entityName(t.debtor_entity_id, data)} doit à ${entityName(t.creditor_entity_id, data)}` : `Dépense payée par ${entityName(t.paid_by_entity_id, data)}`}</p>
              <p>Montant d’origine : {formatMoney(t.amount_cents)} · {formatDay(t.expense_date)}</p><p>Restant à rembourser : <strong>{formatMoney(remaining)}</strong></p>
            </li>;
          })}</ul>
        </>}
      </>}
  </section>;
}
