import { render } from "preact";
import type { SupabaseClient } from "@supabase/supabase-js";
import AgendaPage from "../../../src/features/app/events/AgendaPage";
import AgendaSummary from "../../../src/features/app/events/AgendaSummary";
import type { AppAccess } from "../../../src/features/app/types";
import "../../../public/assets/styles.css";
import "../../../public/assets/admin.css";

// Test transport only; the loopback server executes the real SQL/RLS in an ephemeral DB.
const readOnly = new URLSearchParams(location.search).has("reader");
const client = {
  from(table: string) {
    const query = {
      select() { return query; }, order() { return query; },
      async range(from: number, to: number) {
        return (await fetch(`/fixture-api?table=${table}&from=${from}&to=${to}&reader=${readOnly}`)).json();
      }
    };
    return query;
  },
  async rpc(name: string, args: object) {
    return (await fetch(`/fixture-api?reader=${readOnly}`, { method: "POST", body: JSON.stringify({ name, args }) })).json();
  }
} as unknown as SupabaseClient;
const access: AppAccess = { roles: [], member: null, permissions: readOnly ? ["app.access", "events.read", "members.read"]
  : ["app.access", "events.read", "events.create", "events.update", "events.delete", "members.read"] };
render(<main class="admin-app" style={{ display: "block", padding: "16px", maxWidth: "1280px", margin: "auto" }}>{new URLSearchParams(location.search).has("summary")
  ? <AgendaSummary client={client} onOpen={() => location.assign("/?reader")} /> : <AgendaPage client={client} access={access} />}</main>, document.getElementById("fixture")!);
