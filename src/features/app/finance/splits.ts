import { MAX_CENTS } from "./money.ts";
export interface ExactShare { entity_id: string; amount_cents: bigint }
export function equalSplit(total: bigint, entityIds: string[]): ExactShare[] {
  if (total <= 0n || total > MAX_CENTS || !entityIds.length || entityIds.length > 5000 || new Set(entityIds).size !== entityIds.length) throw new Error("Montant ou participants invalides.");
  const sorted = [...entityIds].sort(), count = BigInt(sorted.length), base = total / count, remainder = total % count;
  // UUID lexicographic order matches PostgreSQL UUID ordering; zero-cent shares are allowed.
  return sorted.map((entity_id, index) => ({ entity_id, amount_cents: base + (BigInt(index) < remainder ? 1n : 0n) }));
}
export function customSplit(total: bigint, shares: ExactShare[]): ExactShare[] {
  if (total <= 0n || total > MAX_CENTS || !shares.length || shares.length > 5000 || new Set(shares.map(s => s.entity_id)).size !== shares.length
    || shares.some(s => s.amount_cents < 0n || s.amount_cents > MAX_CENTS) || shares.reduce((sum, s) => sum + s.amount_cents, 0n) !== total) throw new Error("La somme des parts doit correspondre exactement au total, sans montant négatif ni doublon.");
  return shares;
}
