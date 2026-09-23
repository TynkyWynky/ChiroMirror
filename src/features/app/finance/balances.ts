import { cents } from "./money.ts";
import type { FinanceTransaction, Obligation, Payment, PaymentAllocation } from "./types.ts";
export interface FinancialRows { transactions: FinanceTransaction[]; obligations: Obligation[]; payments: Payment[]; allocations: PaymentAllocation[] }
export function obligationAmounts(obligation: Obligation, data: FinancialRows) {
  const original = cents(obligation.original_amount_cents);
  const activePayments = new Set(data.payments.filter(p => p.status === "ACTIVE").map(p => p.id));
  const paid = data.allocations.filter(a => a.obligation_id === obligation.id && activePayments.has(a.payment_id)).reduce((sum, a) => sum + cents(a.amount_cents), 0n);
  if (paid > original) throw new Error("Données financières incohérentes : remboursements supérieurs à la dette. Actualisez.");
  const cancelled = data.transactions.find(t => t.id === obligation.transaction_id)?.status === "CANCELLED";
  return { original, paid, remaining: cancelled ? 0n : original - paid, cancelled };
}
export function entityBalances(entityId: string | undefined, data: FinancialRows) {
  let payable = 0n, receivable = 0n;
  const counterparties = new Map<string, { payable: bigint; receivable: bigint }>();
  for (const obligation of data.obligations) {
    const debtor = obligation.debtor_entity_id === entityId, creditor = obligation.creditor_entity_id === entityId;
    if (!debtor && !creditor) continue;
    const { remaining } = obligationAmounts(obligation, data);
    const other = debtor ? obligation.creditor_entity_id : obligation.debtor_entity_id;
    const totals = counterparties.get(other) ?? { payable: 0n, receivable: 0n };
    if (debtor) { payable += remaining; totals.payable += remaining; } else { receivable += remaining; totals.receivable += remaining; }
    counterparties.set(other, totals);
  }
  return { payable, receivable, net: receivable - payable, counterparties };
}
