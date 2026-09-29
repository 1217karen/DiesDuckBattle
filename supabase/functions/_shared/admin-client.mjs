// Server-only module. Do not import this into browser code.
export function createRegistrationAdminClient(getEnv, createClient) {
  const url = getEnv("SUPABASE_URL");
  const keys = getEnv("SUPABASE_SECRET_KEYS");
  // Current hosted Edge Functions provide a JSON dictionary of named keys.
  // Invalid configured JSON fails closed; legacy fallback is only for absence
  // of a usable default secret (e.g. local stacks with legacy keys only).
  const secret = keys ? JSON.parse(keys)?.default : undefined;
  const key = typeof secret === "string" && secret ? secret : getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || typeof key !== "string" || !key) throw new Error("Missing server configuration");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // Never copy the incoming Authorization header onto this admin client.
  });
}
