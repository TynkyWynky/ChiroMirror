import { createClient } from "@supabase/supabase-js";
import { createTimedFetch } from "./auth/client";

export function getSupabasePublicConfig() {
  return {
    url: import.meta.env.PUBLIC_SUPABASE_URL ?? "",
    anonKey: import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? ""
  };
}

export function hasSupabasePublicConfig() {
  const { url, anonKey } = getSupabasePublicConfig();
  return Boolean(url && anonKey);
}

export function createServerSupabaseClient() {
  const { url, anonKey } = getSupabasePublicConfig();

  if (!url || !anonKey) {
    return null;
  }

  return createClient(url, anonKey, {
    global: { fetch: createTimedFetch(globalThis.fetch, 8000) },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
