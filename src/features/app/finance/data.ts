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
  if (!data) throw new Error("De rekeningen zijn niet toegankelijk. Ververs je toegangsrechten.");
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
  return member ? `${member.first_name} ${member.last_name}${member.active ? "" : " (gearchiveerd)"}` : "Lid niet zichtbaar";
}
export function actorName(id: string | null, data: FinanceData, userId?: string) {
  if (id && id === userId) return "jij";
  const member = data.members.find(m => m.user_id === id);
  return member ? `${member.first_name} ${member.last_name}` : "aangemeld account (identiteit niet beschikbaar)";
}
export function financeError(cause: unknown): string {
  const network = networkError(cause); if(network)return network;
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    if (cause.code === "40001") return "Deze transactie is gewijzigd. Sluit het formulier, ververs de rekeningen en probeer opnieuw.";
    if (cause.code === "42501") return "Je hebt niet de vereiste rechten voor deze financiële transactie.";
    if (cause.code === "55000") return "Deze transactie is geannuleerd of heeft terugbetalingen. Annuleer eerst de foutieve betalingen en daarna de te corrigeren transactie.";
    if (cause.code === "22003" && "details" in cause && /^\d+$/.test(String(cause.details))) return `Het bedrag is hoger dan het resterende saldo van ${formatMoney(String(cause.details))}.`;
    if (["22023", "23514", "23503", "23502", "23505", "22P02", "22003"].includes(String(cause.code))) return "Controleer de bedragen, de som van de aandelen, de datum en de geselecteerde actieve leden.";
  }
  return cause instanceof Error ? cause.message : "De rekeningen konden niet worden geladen of opgeslagen. Probeer opnieuw.";
}
