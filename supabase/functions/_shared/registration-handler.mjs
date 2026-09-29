import { registerAccount, validateRegistration } from "./registration.mjs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (body, status, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", ...extra },
});

/**
 * Lazy client creation: malformed input/preflight must never reach the backend.
 * @param {{createAdminClient: Function, log?: (event: string, context: Record<string, string>) => void, uuid?: () => string}} dependencies
 */
export function createRegistrationHandler({ createAdminClient, log = () => {}, uuid }) {
  return async request => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405, { Allow: "POST, OPTIONS" });
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return json({ ok: false, error: "json_required" }, 415);
    }
    let input;
    try { input = await request.json(); } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    if (!validateRegistration(input)) return json({ ok: false, error: "invalid_input" }, 400);
    try {
      const result = await registerAccount(input, { client: createAdminClient(), log, uuid });
      return json(result.body, result.status);
    } catch {
      // Environment/client initialization failures must not leak secret values.
      try { log("registration_unavailable", {}); } catch { /* no sensitive fallback */ }
      return json({ ok: false, error: "registration_unavailable" }, 500);
    }
  };
}
