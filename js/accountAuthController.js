import { createAccountOperationCoordinator } from "./accountOperationCoordinator.js";
import { createAccountScopedClient } from "./accountScopedClient.js";
import { createAccountDeletionService, deletionMessages } from "./accountDeletionService.js";
import { canonicalEno } from "../supabase/functions/_shared/internal-email.mjs";

const messages = {
  "already-added": "追加済みのENoです。一覧から選択してください。",
  "reauthentication-required": "セッションの期限が切れています。このENoで再ログインしてください。",
  "operation-in-progress": "保存などの処理中です。完了してから操作してください。",
  "cleanup-required": "未完了のログインがあります。メニューの清掃操作を実行してください。",
  "deletion-recovery-required": "削除の復旧待ちです。メニューの削除状況を確認してください。",
  "login-failed": "ENoまたはパスワードを確認してください。",
  "cancelled": "操作をキャンセルしました。",
};
export function createAccountAuthController({ runtime, registrationService, notify = () => {},
  navigate = () => {}, clearCache = () => {} }) {
  const coordinator = createAccountOperationCoordinator(runtime);
  const listeners = new Set();
  let ready = false, busy = "", message = "", source = "", registeredEno = "";
  let logoutSucceeded = false, accountDeletionPending = false, accountDeletionSucceeded = false;
  let deletionAccount = null, stopped = false;
  const snapshot = () => {
    const current = runtime.getCurrent()?.account;
    const selected = current ?? (accountDeletionPending ? deletionAccount : null);
    const state = runtime.snapshot();
    return { ready: ready && (!state.busy || accountDeletionPending), sessionKnown: ready && (!state.busy || accountDeletionPending), busy: busy || (accountDeletionPending ? "" : state.busy) || "",
      signedIn: !!selected, accountsResolved: !!selected, accounts: selected ? [{ ...selected }] : [],
      enos: selected ? [selected.eno] : [], savedAccounts: state.entries, pendingAccounts: state.pending, deletionRecoveries: state.deletions,
      sessionMessage: selected ? "ログイン中" : "ログインしていません。", message, messageSource: source,
      registeredEno, logoutSucceeded, accountDeletionPending, accountDeletionSucceeded,
      accountSwitching: true };
  };
  function emit() {
    // pagehide invalidates leases but must not redirect the departing document.
    if (runtime.snapshot().code === "pagehide") return;
    if (!stopped) for (const listener of listeners) {
      try { listener(snapshot()); } catch { /* Presentation errors cannot reinterpret an Auth outcome. */ }
    }
  }
  const stop = runtime.subscribe(emit);
  async function action(kind, work, redirect = true) {
    if (!ready || busy || runtime.snapshot().busy || accountDeletionPending) return { ok: false, code: "operation-in-progress" };
    busy = kind; source = kind; message = ""; emit();
    let result;
    try {
      result = await work();
      if (!result?.ok) message = result?.message ?? messages[result?.code] ?? "処理を完了できません。通信状況を確認して再読み込みしてください。";
      else {
        clearCache(); if (kind === "logout") logoutSucceeded = true;
        if (redirect) navigate("index.html");
      }
      return result;
    } catch { message = "処理結果を確認できません。自動再送せず再読み込みしてください。"; return { ok: false }; }
    finally { busy = ""; emit(); }
  }
  const login = (eno, password) => action("login", async () => {
    try { eno = canonicalEno(eno.trim()); } catch { return { ok: false, code: "login-failed" }; }
    const known = runtime.snapshot().entries.find(entry => entry.eno === eno);
    const result = known ? await coordinator.reauthenticate(eno, password) : await coordinator.add(eno, password);
    if (result.ok) { registeredEno = ""; notify("ログインしました。"); }
    return result;
  });
  return {
    coordinator, runtime, snapshot,
    async start() { const result = await runtime.initialize(); ready = true; if (!result.ok) message = messages[result.code] ?? "ログイン状態を確認できません。再読み込みしてください。"; emit(); return result; },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    beforeLogout: guard => coordinator.beforeAccountChange(guard),
    login, add: login,
    select: eno => action("select", () => coordinator.select(eno)),
    logout: () => action("logout", () => coordinator.logoutCurrent()),
    cleanupDeleted: target => action("cleanup-deleted", () => coordinator.cleanupDeleted(target), false),
    cleanupPending: slot => action("cleanup", () => coordinator.cleanupPending(slot), false),
    register: (input, { notify: shouldNotify = true } = {}) => action("register", async () => {
      // Registration is available only while unselected. Never overwrite an active session.
      if (runtime.getCurrent()) return { ok: false, code: "already-added" };
      const result = await registrationService.register(input);
      if (!result.ok) { message = result.message; return result; }
      registeredEno = canonicalEno(result.eno);
      const signed = await coordinator.add(registeredEno, input.password);
      if (!signed.ok) { message = `登録は完了しました。ENo.${registeredEno}でログインしてください。`; return { ok: true, signedIn: false, eno: registeredEno }; }
      const eno = registeredEno; registeredEno = "";
      if (shouldNotify) notify(`新規登録しました。あなたはENo.${eno}です。`);
      navigate("index.html"); return { ok: true, signedIn: true, eno };
    }, false),
    getClient() {
      const context = runtime.getCurrent();
      if (!context) return null;
      return createAccountScopedClient({ context, runtime, coordinator });
    },
    beginAccountDeletion() { deletionAccount = runtime.getCurrent()?.account ?? null; accountDeletionPending = true; emit(); },
    endAccountDeletion() { accountDeletionPending = false; deletionAccount = null; emit(); },
    accountDeleted() { accountDeletionPending = false; deletionAccount = null; accountDeletionSucceeded = true; clearCache(); emit(); },
    createDeletionService() {
      const context = runtime.getCurrent();
      if (!context) throw Error("No verified account");
      const scoped = createAccountScopedClient({ context, runtime, coordinator });
      const service = createAccountDeletionService(scoped);
      return {
        prepare: expected => service.prepare(expected),
        async remove(target) {
          if (!scoped.accountContext.isCurrent() || ["eno", "gameAccountId", "authUserId"].some(key => context.account[key] !== target[key])
            || coordinator.snapshot().writes || coordinator.snapshot().changing) return { ok: false, message: deletionMessages.changed };
          const result = await runtime.deleteCurrent(target);
          return result.ok && result.deleted ? { ok: true } : { ok: false, message: deletionMessages.unknown };
        },
        async cleanup(target) {
          const result = await runtime.cleanupDeleted(target);
          return result.ok ? { ok: true } : { ok: false, status: "cleanup", message: deletionMessages.cleanup };
        },
      };
    },
    stop() { stopped = true; stop(); coordinator.dispose(); runtime.dispose(); listeners.clear(); },
  };
}
