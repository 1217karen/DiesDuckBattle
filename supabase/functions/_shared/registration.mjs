import { canonicalEno, internalEmailForEno } from "./internal-email.mjs";
import { isRegistrationPasswordLongEnough } from "./registration-password.mjs";

export function validateRegistration(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || typeof input.characterName !== "string" || !input.characterName.trim()
    || typeof input.password !== "string") {
    return null;
  }
  // Never trim the password. Length is checked before any side effect below.
  return { characterName: input.characterName.trim(), password: input.password };
}

// Log only controlled labels and server-generated IDs. Never pass upstream
// errors to a logger: their message/details may contain request data or secrets.
function safeLog(log, event, context) {
  try { log(event, context); } catch { /* Logging must not interrupt compensation. */ }
}

function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}

/** client is a server-only Supabase admin client; injected for offline tests. */
export async function registerAccount(input, { client, log = () => {}, uuid = () => crypto.randomUUID() }) {
  const valid = validateRegistration(input);
  if (!valid) return { status: 400, body: { ok: false, error: "invalid_input" } };
  if (!isRegistrationPasswordLongEnough(valid.password)) {
    return { status: 400, body: { ok: false, error: "password_too_short" } };
  }

  // Allocate the UUID, NOT the ENo, before INSERT. It permits targeted cleanup
  // even if the database committed the INSERT but its response was lost.
  const gameAccountId = uuid();
  let authUserId = null;
  let stage = "game_account";
  try {
    const account = checked(await client.from("game_accounts")
      .insert({ id: gameAccountId }).select("eno::text").single());
    const eno = canonicalEno(account.eno);
    const email = internalEmailForEno(eno);

    stage = "auth_user";
    const auth = checked(await client.auth.admin.createUser({
      email, password: valid.password, email_confirm: true,
    }));
    if (!auth?.user?.id) throw new Error("Missing created user");
    authUserId = auth.user.id;

    stage = "access";
    checked(await client.from("game_account_access").insert({
      auth_user_id: authUserId, game_account_id: gameAccountId,
    }));
    stage = "battler";
    checked(await client.from("battlers").insert({
      game_account_id: gameAccountId, presentation: { name: valid.characterName },
      // build defaults to {}; no Ducks are created.
    }));
    return { status: 201, body: { ok: true, eno } };
  } catch (error) {
    // Preserve the original failure stage/status even when cleanup also fails.
    const status = stage === "auth_user" && error?.code === "weak_password" ? 400 : 502;
    const code = status === 400 ? "password_rejected" : `${stage}_creation_failed`;
    safeLog(log, "registration_failed", { stage, gameAccountId });
    try {
      checked(await client.from("game_accounts").delete().eq("id", gameAccountId));
    } catch {
      safeLog(log, "registration_cleanup_failed", { target: "game_account", gameAccountId });
    }
    // Always try Auth cleanup independently of DB cleanup. Never look up/delete
    // an existing user by email on identity collision or an ambiguous response.
    if (authUserId) {
      try {
        checked(await client.auth.admin.deleteUser(authUserId));
      } catch {
        safeLog(log, "registration_cleanup_failed", { target: "auth_user", gameAccountId, authUserId });
      }
    }
    return { status, body: { ok: false, error: code } };
  }
}
