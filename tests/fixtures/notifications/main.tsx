import { render } from "preact";
import { useState } from "preact/hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import NotificationBell from "../../../src/features/app/notifications/NotificationBell";
import NotificationSettings from "../../../src/features/app/notifications/NotificationSettings";
import "../../../public/assets/styles.css";
import "../../../public/assets/admin.css";
const api = async (body: object) => (await fetch('/fixture-api', { method:'POST', body:JSON.stringify(body) })).json();
const client = {
  from(table: string) {
    const options: Record<string, unknown> = { table };
    const q = {
      select(columns: string, opts?: object) { Object.assign(options, { columns, ...opts });return q; }, order(){return q;},
      eq(column: string,value: unknown){Object.assign(options,{column,value});return q;},is(column: string,value: unknown){return q.eq(column,value);},
      maybeSingle(){options.single=true;return q;},limit(limit:number){options.limit=limit;return q;},range(from:number,to:number){Object.assign(options,{from,limit:to-from+1});return q;},
      then(resolve: (v: unknown)=>unknown,reject?: (e:unknown)=>unknown){return api(options).then(resolve,reject);}
    };return q;
  },rpc(name:string,args:object){return api({name,args});}
} as unknown as SupabaseClient;
function Fixture(){
  const [target,setTarget]=useState("");
  return <main class="admin-app" style={{display:'block',padding:'16px',maxWidth:'1100px',margin:'auto'}}><NotificationBell client={client} userId="00000000-0000-0000-0000-000000000001" onTarget={t=>setTarget(`${t.type}:${t.id}:${t.occurrence??''}`)} /><p data-testid="target">{target}</p><NotificationSettings client={client} userId="00000000-0000-0000-0000-000000000001" publicKey={'A'.repeat(87)} /></main>;
}
render(<Fixture/>,document.getElementById('fixture')!);
