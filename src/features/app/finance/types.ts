// PostgREST returns bigint columns as JSON numbers. DB bounds each row below 2^53;
// normalize immediately, and perform all monetary calculations exclusively with bigint.
export type Cents = string | number;
export interface FinancialEntity { id: string; type: "MEMBER" | "CHIRO"; member_id: string | null }
export interface FinanceTransaction {
  id: string; kind: "EXPENSE" | "DIRECT_DEBT"; title: string; description: string | null;
  amount_cents: Cents; currency: "EUR"; paid_by_entity_id: string | null;
  debtor_entity_id: string | null; creditor_entity_id: string | null;
  split_mode: "EQUAL" | "CUSTOM_AMOUNT" | null; expense_date: string;
  visibility: "PRIVATE" | "TREASURY"; status: "ACTIVE" | "CANCELLED";
  revision: number; created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
}
export interface ExpenseShare { transaction_id: string; entity_id: string; amount_cents: Cents }
export interface Obligation { id: string; transaction_id: string; debtor_entity_id: string; creditor_entity_id: string; original_amount_cents: Cents }
export interface Payment {
  id: string; transaction_id: string; from_entity_id: string; to_entity_id: string; amount_cents: Cents;
  payment_date: string; comment: string | null; status: "ACTIVE" | "CANCELLED";
  created_by: string | null; created_at: string; cancelled_by: string | null; cancelled_at: string | null; cancellation_reason: string | null;
}
export interface PaymentAllocation { payment_id: string; obligation_id: string; amount_cents: Cents }
export interface FinanceActivity { id: string; transaction_id: string; actor_id: string | null; action: string; created_at: string; metadata: { reason?: string; amount_cents?: string; before_amount_cents?: string; after_amount_cents?: string } }
export interface FinanceDraft {
  kind: FinanceTransaction["kind"]; title: string; description: string; amount: string;
  payer: string; debtor: string; creditor: string; date: string; visibility: FinanceTransaction["visibility"];
  split: "EQUAL" | "CUSTOM_AMOUNT"; shares: { entity_id: string; amount: string }[];
}
