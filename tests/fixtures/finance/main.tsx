import { render } from "preact";
import type { SupabaseClient } from "@supabase/supabase-js";
import FinancePage from "../../../src/features/app/finance/FinancePage";
import FinanceSummary from "../../../src/features/app/finance/FinanceSummary";
import type { AppAccess } from "../../../src/features/app/types";
import "../../../public/assets/styles.css";
import "../../../public/assets/admin.css";
const params = new URLSearchParams(location.search), actor = params.get("actor") ?? "1";
// Loopback test transport only; SQL functions and RLS run in real ephemeral PostgreSQL.
const api = async (path: string, init?: RequestInit) => (await fetch(`/fixture-api?actor=${actor}&${path}`, init)).json();
const client = {
  from(table: string) {
    let transaction = "";
    const query = { select() { return query; }, order() { return query; }, eq(column: string, value: string) { if (column !== "transaction_id") throw new Error("Unexpected filter"); transaction = value; return query; },
      limit(count: number) { return api(`table=${table}&transaction=${transaction}&limit=${count}`); } };
    return query;
  },
  rpc(name: string, args: object = {}) { return api("", { method: "POST", body: JSON.stringify({ name, args }) }); }
} as unknown as SupabaseClient;
async function start() {
  const result = await api("access=1"); if (result.error) throw new Error(result.error.message);
  const access: AppAccess = result.data, userId = `00000000-0000-0000-0000-${actor.padStart(12, "0")}`;
  render(<main class="admin-app" style={{ display: "block", padding: "16px", maxWidth: "1280px", margin: "auto" }}>
    {params.has("summary") ? <FinanceSummary client={client} access={access} onOpen={() => location.assign(`/?actor=${actor}`)} /> : <FinancePage client={client} access={access} userId={userId} />}
  </main>, document.getElementById("fixture")!);
}
void start();
