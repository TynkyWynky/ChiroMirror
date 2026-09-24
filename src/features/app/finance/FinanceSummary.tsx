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
  return <section class="admin-subpanel" lang="nl"><h2>Mijn rekeningen</h2>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setAttempt(n => n + 1)}>Opnieuw proberen</button></p> : totals ? <><p>Te betalen: <strong>{formatMoney(totals.payable)}</strong></p><p>Te ontvangen: <strong>{formatMoney(totals.receivable)}</strong></p></> : <p role="status">Rekeningen laden…</p>}
    <button class="btn btn-light" type="button" onClick={onOpen}>Mijn rekeningen openen</button>
  </section>;
}
