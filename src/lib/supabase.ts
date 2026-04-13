import { createClient } from "@supabase/supabase-js";

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
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
