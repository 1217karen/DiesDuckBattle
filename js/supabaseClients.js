import { supabasePublicConfig } from "./supabasePublicConfig.js";

// Exactly one SDK instance per storage key in a page. Only the SDK stores tokens.
const clients = new Map();
function client(key, persistent = true) {
  if (!clients.has(key)) clients.set(key, (async () => {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.117.2?bundle");
    return createClient(supabasePublicConfig.url, supabasePublicConfig.publishableKey, {
      auth: { storageKey: key, persistSession: persistent, autoRefreshToken: persistent, detectSessionInUrl: false },
    });
  })());
  return clients.get(key);
}
export const getLegacySupabaseClient = () => client("diesduck-auth-session");
export const getPublicSupabaseClient = () => client("diesduck-public", false);
export const getOperatorSupabaseClient = () => client("diesduck-operator-session");
