import { useEffect, useState } from "preact/hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppAccess } from "../types";
import { ownEntity } from "./access";
import { entityBalances } from "./balances";
import { financeError, loadFinance } from "./data";
import { formatMoney } from "./money";
export default function FinanceSummary({ client, access, onOpen }: { client: SupabaseClient; access: AppAccess; onOpen: () => void }) {
  const [totals, setTotals] = useState<{ payable: bigint; receivable: bigint } | null>(null), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setTotals(null); setError("");
    loadFinance(client).then(data => { if (active) setTotals(entityBalances(ownEntity(data.entities, access), data)); }).catch(cause => { if (active) setError(financeError(cause)); });
    return () => { active = false; };
  }, [client, access, attempt]);
  return <section class="admin-subpanel" lang="fr"><h2>Mes comptes</h2>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setAttempt(n => n + 1)}>Réessayer</button></p> : totals ? <><p>À payer : <strong>{formatMoney(totals.payable)}</strong></p><p>À recevoir : <strong>{formatMoney(totals.receivable)}</strong></p></> : <p role="status">Chargement des comptes…</p>}
    <button class="btn btn-light" type="button" onClick={onOpen}>Ouvrir mes comptes</button>
  </section>;
}
