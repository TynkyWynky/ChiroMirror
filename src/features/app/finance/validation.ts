import { civil, today } from "../events/dates.ts";
import { moneyInput, parseMoney } from "./money.ts";
import { customSplit, equalSplit } from "./splits.ts";
import type { FinanceData } from "./data.ts";
import type { FinanceDraft, FinanceTransaction } from "./types.ts";
export function makeFinanceDraft(kind: FinanceDraft["kind"], own = "", transaction?: FinanceTransaction, data?: FinanceData): FinanceDraft {
  return { kind, title: transaction?.title ?? "", description: transaction?.description ?? "", amount: transaction ? moneyInput(transaction.amount_cents) : "",
    payer: transaction?.paid_by_entity_id ?? own, debtor: transaction?.debtor_entity_id ?? own, creditor: transaction?.creditor_entity_id ?? "",
    date: transaction?.expense_date ?? today(), visibility: transaction?.visibility ?? "PRIVATE", split: transaction?.split_mode ?? "EQUAL",
    shares: data?.shares.filter(s => s.transaction_id === transaction?.id).map(s => ({ entity_id: s.entity_id, amount: moneyInput(s.amount_cents) })) ?? [] };
}
export function validateFinance(draft: FinanceDraft, data: FinanceData, previous?: FinanceTransaction) {
  const title = draft.title.trim(), description = draft.description.trim();
  if (!title || title.length > 200 || description.length > 10000) throw new Error("Le motif est obligatoire (200 caractères maximum).");
  if (!["PRIVATE", "TREASURY"].includes(draft.visibility) || !["EXPENSE", "DIRECT_DEBT"].includes(draft.kind)) throw new Error("Type ou visibilité invalide.");
  const amount = parseMoney(draft.amount), expense_date = civil(draft.date).toString();
  if (draft.kind === "EXPENSE" && !["EQUAL", "CUSTOM_AMOUNT"].includes(draft.split)) throw new Error("Répartition invalide.");
  const shares = draft.kind !== "EXPENSE" ? [] : draft.split === "EQUAL" ? equalSplit(amount, draft.shares.map(s => s.entity_id))
    : customSplit(amount, draft.shares.map(s => ({ entity_id: s.entity_id, amount_cents: parseMoney(s.amount, true) })));
  const ids = draft.kind === "EXPENSE" ? [draft.payer, ...shares.map(s => s.entity_id)] : [draft.debtor, draft.creditor];
  const originalIds = previous ? [previous.paid_by_entity_id, previous.debtor_entity_id, previous.creditor_entity_id, ...data.shares.filter(s => s.transaction_id === previous.id).map(s => s.entity_id)] : [];
  for (const id of ids) {
    const entity = data.entities.find(e => e.id === id), member = data.members.find(m => m.id === entity?.member_id);
    if (!entity || entity.type === "MEMBER" && (!member || !member.active && !originalIds.includes(id))) throw new Error("Choisissez des membres actifs pour une nouvelle affectation.");
  }
  const chiro = ids.some(id => data.entities.find(e => e.id === id)?.type === "CHIRO");
  if (draft.visibility === "PRIVATE" && chiro || draft.visibility === "TREASURY" && !chiro) throw new Error("Une opération de trésorerie doit impliquer la Chiro ; une opération privée concerne uniquement des membres.");
  if (draft.kind === "DIRECT_DEBT" && draft.debtor === draft.creditor) throw new Error("Une personne ne peut pas se devoir de l’argent à elle-même.");
  return { details: { kind: draft.kind, title, description: description || null, amount_cents: amount.toString(), expense_date, visibility: draft.visibility,
    paid_by_entity_id: draft.kind === "EXPENSE" ? draft.payer : null, debtor_entity_id: draft.kind === "DIRECT_DEBT" ? draft.debtor : null,
    creditor_entity_id: draft.kind === "DIRECT_DEBT" ? draft.creditor : null, split_mode: draft.kind === "EXPENSE" ? draft.split : null },
    shares: shares.map(s => ({ entity_id: s.entity_id, amount_cents: s.amount_cents.toString() })) };
}
