import { canonicalEno, internalEmailForEno } from "../supabase/functions/_shared/internal-email.mjs";
import { registrationPasswordError } from "../supabase/functions/_shared/registration-password.mjs";

export const authMessages = Object.freeze({
  invalid_input: "キャラ名とパスワードを入力してください。",
  password_mismatch: "パスワード確認が一致しません。",
  password_too_short: "パスワードは6文字以上で入力してください。",
  password_alphanumeric_required: "パスワードには半角英字と数字をそれぞれ1文字以上含めてください。",
  password_rejected: "パスワードが認証サービスの要件を満たしていません。別のパスワードを指定してください。",
  unknown: "登録結果を確認できませんでした。登録が成功している可能性があります。再登録する前に状況を確認してください。自動再送は行いません。",
  server: "サーバー側で登録に失敗しました。時間をおいて、状況を確認してください。",
  login: "ENoまたはパスワードを確認してください。",
});
const fail = message => ({ ok: false, message });
const serverCodes = new Set(["game_account_creation_failed", "auth_user_creation_failed",
  "access_creation_failed", "battler_creation_failed", "registration_unavailable"]);

export function registrationInput({ characterName, password, confirmation }) {
  if (typeof characterName !== "string" || !characterName.trim()
    || typeof password !== "string") return fail(authMessages.invalid_input);
  const passwordError = registrationPasswordError(password);
  if (passwordError) return fail(authMessages[passwordError]);
  if (password !== confirmation) return fail(authMessages.password_mismatch);
  return { ok: true, body: { characterName: characterName.trim(), password } };
}

/** SDK and fetch are injected so tests never need a real Supabase account. */
export function createAuthService({ client, config, fetchImpl = fetch }) {
  return {
    async register(input) {
      const validated = registrationInput(input);
      if (!validated.ok) return validated;
      // One POST only: retry could create a second independent ENo.
      try {
        const response = await fetchImpl(config.url + "/functions/v1/register-account", {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: config.publishableKey },
          body: JSON.stringify(validated.body),
        });
        const body = await response.json();
        if (response.status === 201 && body.ok === true && typeof body.eno === "string") {
          return { ok: true, eno: canonicalEno(body.eno) };
        }
        if (!response.ok && body.ok === false) {
          if (["invalid_input", "password_rejected", "password_too_short", "password_alphanumeric_required"].includes(body.error)) {
            return fail(authMessages[body.error]);
          }
          if (serverCodes.has(body.error)) return fail(authMessages.server);
        }
        return fail(authMessages.unknown);
      } catch { return fail(authMessages.unknown); }
    },
    async login(eno, password) {
      try {
        if (typeof eno !== "string" || typeof password !== "string" || !password) return fail(authMessages.login);
        const email = internalEmailForEno(canonicalEno(eno.trim()));
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error || !data?.session) return fail(authMessages.login);
        return { ok: true, session: data.session };
      } catch { return fail(authMessages.login); }
    },
    async session() {
      const { data, error } = await client.auth.getSession();
      if (error) throw new Error("Session unavailable");
      return data.session;
    },
    watch(callback) {
      // Keep Supabase's auth callback synchronous; defer SDK queries to avoid its lock.
      const timers = new Set();
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        const timer = setTimeout(() => { timers.delete(timer); callback(session); }, 0);
        timers.add(timer);
      });
      return () => { data.subscription.unsubscribe(); timers.forEach(clearTimeout); };
    },
    async accounts(session) {
      const { data, error } = await client.from("game_account_access")
        .select("game_account_id,game_accounts!inner(eno::text,battlers(presentation))")
        .eq("auth_user_id", session.user.id);
      if (error || !Array.isArray(data)) throw new Error("Access unavailable");
      // Do not infer the game-account UUID from Auth, or choose the first account.
      return data.map(row => ({
        eno: canonicalEno(row.game_accounts.eno),
        name: typeof row.game_accounts.battlers?.presentation?.name === "string"
          ? row.game_accounts.battlers.presentation.name : null,
      })).sort((a, b) => BigInt(a.eno) < BigInt(b.eno) ? -1 : BigInt(a.eno) > BigInt(b.eno) ? 1 : 0);
    },
    async logout() {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw new Error("Sign out failed");
    },
  };
}
