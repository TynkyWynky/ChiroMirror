import { render } from "preact";
import type { SupabaseClient } from "@supabase/supabase-js";
import TasksPage from "../../../src/features/app/tasks/TasksPage";
import TaskSummary from "../../../src/features/app/tasks/TaskSummary";
import type { AppAccess } from "../../../src/features/app/types";
import "../../../public/assets/styles.css";
import "../../../public/assets/admin.css";

// Browser-only test transport to the loopback server; every query executes real SQL/RLS.
const params = new URLSearchParams(location.search), actor = params.get("actor") ?? "1";
const api = async (path: string, init?: RequestInit) => (await fetch(`/fixture-api?actor=${actor}&${path}`, init)).json();
const client = {
  from(table: string) {
    let taskId = "";
    const query = {
      select() { return query; }, order() { return query; },
      eq(column: string, value: string) { if (column !== "task_id") throw new Error("Unexpected fixture filter"); taskId = value; return query; },
      range(from: number, to: number) { return api(`table=${table}&from=${from}&to=${to}&task=${taskId}`); },
      limit(count: number) { return query.range(0, count - 1); }
    };
    return query;
  },
  rpc(name: string, args: object) { return api("", { method: "POST", body: JSON.stringify({ name, args }) }); }
} as unknown as SupabaseClient;
async function start() {
  const result = await api("access=1");
  if (result.error) throw new Error(result.error.message);
  const access: AppAccess = result.data;
  const userId = `00000000-0000-0000-0000-${actor.padStart(12, "0")}`;
  render(<main class="admin-app" style={{ display: "block", padding: "16px", maxWidth: "1280px", margin: "auto" }}>
    {params.has("summary") ? <TaskSummary client={client} access={access} userId={userId} onOpen={() => location.assign(`/?actor=${actor}`)} /> : <TasksPage client={client} access={access} userId={userId} />}
  </main>, document.getElementById("fixture")!);
}
void start();
