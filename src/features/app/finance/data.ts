import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOnline, networkError } from "../pwa/network.ts";
import type { Member } from "../types.ts";
import type { ExpenseShare, FinancialEntity, FinanceActivity, FinanceTransaction, Obligation, Payment, PaymentAllocation } from "./types.ts";
import { formatMoney } from "./money.ts";
export interface FinanceData {
  entities: FinancialEntity[]; members: Member[]; transactions: FinanceTransaction[]; shares: ExpenseShare[];
  obligations: Obligation[]; payments: Payment[]; allocations: PaymentAllocation[];
}
export const emptyFinance: FinanceData = { entities: [], members: [], transactions: [], shares: [], obligations: [], payments: [], allocations: [] };
export async function loadFinance(client: SupabaseClient): Promise<FinanceData> {
  const { data, error } = await client.rpc("get_app_finance_snapshot");
  if (error) throw error;
  if (!data) throw new Error("L’accès aux comptes n’est pas disponible. Actualisez vos accès.");
  return data as FinanceData;
}
export async function loadActivity(client: SupabaseClient, transactionId: string): Promise<FinanceActivity[]> {
  const { data, error } = await client.from("app_finance_activity").select("*").eq("transaction_id", transactionId).order("created_at", { ascending: false }).order("id").limit(100);
  if (error) throw error;
  return data ?? [];
}
export async function financeRpc(client: SupabaseClient, name: string, args: object) { requireOnline(); const { error } = await client.rpc(name, args); if (error) throw error; }
export function entityName(id: string | null, data: FinanceData) {
  const entity = data.entities.find(e => e.id === id);
  if (entity?.type === "CHIRO") return "Chiro Negenmanneke";
  const member = data.members.find(m => m.id === entity?.member_id);
  return member ? `${member.first_name} ${member.last_name}${member.active ? "" : " (archivé)"}` : "Membre non consultable";
}
export function actorName(id: string | null, data: FinanceData, userId?: string) {
  if (id && id === userId) return "vous";
  const member = data.members.find(m => m.user_id === id);
  return member ? `${member.first_name} ${member.last_name}` : "compte authentifié (identité indisponible)";
}
export function financeError(cause: unknown): string {
  const network = networkError(cause); if(network)return network;
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    if (cause.code === "40001") return "Cette opération a changé. Fermez le formulaire, actualisez les comptes puis recommencez.";
    if (cause.code === "42501") return "Vous n’avez pas les droits nécessaires pour cette opération financière.";
    if (cause.code === "55000") return "Cette opération est annulée ou possède des remboursements. Annulez explicitement les paiements erronés puis l’opération à corriger.";
    if (cause.code === "22003" && "details" in cause && /^\d+$/.test(String(cause.details))) return `Le montant dépasse le solde restant de ${formatMoney(String(cause.details))}.`;
    if (["22023", "23514", "23503", "23502", "23505", "22P02", "22003"].includes(String(cause.code))) return "Vérifiez les montants, la somme des parts, la date et les membres actifs sélectionnés.";
  }
  return cause instanceof Error ? cause.message : "Impossible de charger ou d’enregistrer les comptes. Réessayez.";
}
