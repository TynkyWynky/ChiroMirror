import type { Cents } from "./types.ts";
export const MAX_CENTS = 999999999999n;
export function cents(value: Cents | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Ongeldig geheel bedrag.");
  if (!/^-?\d+$/.test(String(value))) throw new Error("Ongeldig geheel bedrag.");
  return BigInt(value);
}
export function parseMoney(value: string, allowZero = false): bigint {
  const normalized = value.trim().replace(/[\s\u00a0\u202f]/g, "");
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(normalized)) throw new Error("Vul een bedrag in euro in met maximaal twee decimalen.");
  const [units, fraction = ""] = normalized.split(/[,.]/);
  const result = BigInt(units) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (result < (allowZero ? 0n : 1n) || result > MAX_CENTS) throw new Error("Het bedrag moet positief en kleiner dan 10 miljard euro zijn.");
  return result;
}
export function moneyInput(value: Cents | bigint): string {
  const amount = cents(value), absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "-" : ""}${absolute / 100n},${String(absolute % 100n).padStart(2, "0")}`;
}
export function formatMoney(value: Cents | bigint): string {
  const [units, fraction] = moneyInput(value).split(",");
  return `${units.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f")},${fraction}\u00a0€`;
}
