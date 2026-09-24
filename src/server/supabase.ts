import { createClient } from "@supabase/supabase-js";
import { createTimedFetch } from "../lib/auth/client";

/** Server routes only: this client bypasses RLS. Authorize every privileged operation. */
export function createServiceClient() {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: createTimedFetch(globalThis.fetch, 10000) }
  });
}
