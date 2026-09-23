import type { AppAccess } from "../types.ts";
import type { FinancialEntity, FinanceTransaction, Obligation, Payment } from "./types.ts";
export const financeAccess = (access: AppAccess) => access.permissions.includes("app.access") && access.permissions.includes("finance.access");
export const treasuryManage = (access: AppAccess) => financeAccess(access) && access.permissions.includes("finance.treasury.manage");
export const ownEntity = (entities: FinancialEntity[], access: AppAccess) => entities.find(e => e.member_id && e.member_id === access.member?.id)?.id;
export function canManage(transaction: FinanceTransaction, access: AppAccess, userId: string) {
  return financeAccess(access) && (transaction.visibility === "TREASURY" ? treasuryManage(access) : transaction.created_by === userId);
}
export function canRecord(transaction: FinanceTransaction, obligation: Obligation | Payment, access: AppAccess, entityId?: string) {
  const from = "debtor_entity_id" in obligation ? obligation.debtor_entity_id : obligation.from_entity_id;
  const to = "creditor_entity_id" in obligation ? obligation.creditor_entity_id : obligation.to_entity_id;
  return financeAccess(access) && (transaction.visibility === "TREASURY" ? treasuryManage(access) : Boolean(entityId && (entityId === from || entityId === to)));
}
