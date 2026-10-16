import { createAccountSessionManager } from "./accountSessionManager.js";
import { supabasePublicConfig } from "./supabasePublicConfig.js";

/** Opt-in adapter only: production page entry points still use authRuntime.js.
 * Session creation, persistence, access verification and locking belong to the manager.
 */
export function createAccountRuntime({ manager, events = globalThis.window, document = globalThis.document, suspendOnHidden = true }) {
  let revision = 0, selectionVersion = 0, disposed = false, busy = null, code = null, phase = "unverified";
  let entries = [], pending = [], deletions = [], verified = null;
  const listeners = new Set();
  function current() {
    if (disposed || busy || !verified?.isCurrent()) return null;
    return verified;
  }
  function snapshot() {
    const selected = current();
    return {
      phase: phase === "ready" && !selected ? "unverified" : phase,
      busy, code, current: selected ? { ...selected.account } : null,
      deletions: deletions.map(item => ({ ...item })),
      entries: entries.map(entry => ({ ...entry })), pending: pending.map(entry => ({ ...entry })),
    };
  }
  function emit() {
    if (disposed) return;
    for (const listener of listeners) {
      try { listener(snapshot()); } catch { /* A UI subscriber must not change operation outcomes. */ }
    }
  }
  // Manager owns SDK/storage/pageshow invalidation. Notification callbacks never call SDK APIs.
  const stopInvalidation = manager.subscribeInvalidation(reason => {
    selectionVersion++;
    const list = manager.list();
    entries = list.ok ? list.entries : [];
    pending = list.ok ? list.pending : [];
    deletions = list.ok ? list.deletions ?? [] : [];
    verified = null;
    if (reason !== "auth" || !busy) { revision++; busy = null; phase = "unverified"; code = reason; }
    queueMicrotask(emit);
  });
  function pageHidden() {
    if (suspendOnHidden && document.visibilityState === "hidden") manager.invalidate("page-hidden");
  }
  function pageHide() { manager.invalidate("pagehide"); }
  document?.addEventListener("visibilitychange", pageHidden);
  events?.addEventListener("pagehide", pageHide);

  function installLease(token) {
    const lease = manager.getActiveLease();
    if (!lease?.isCurrent()) { verified = null; return; }
    const account = Object.freeze({ ...lease.account });
    const wrapper = Object.freeze({ account, client: lease.client,
      isCurrent: () => !disposed && !busy && token === revision && verified === wrapper && lease.isCurrent(),
    });
    verified = wrapper;
  }
  function selectedFailure(list, restored) {
    if (!list.ok) return list.code;
    if (list.active === null) return null;
    const status = restored?.entries?.find(entry => entry.slot === list.active)?.status;
    return status && status !== "ready" ? status : "verification-unavailable";
  }
  async function run(action, work) {
    if (disposed) return { ok: false, code: "closed" };
    const previous = current(), previousSlot = previous ? manager.list().active : null;
    const token = ++revision;
    verified = null; busy = action; phase = "busy"; code = null;
    emit();
    if (disposed || token !== revision) return { ok: false, code: "stale-operation" };
    let result, recoveryFailed = false;
    try { result = await work(); } catch { result = { ok: false, code: "verification-unavailable" }; }
    if (disposed || token !== revision) return { ok: false, code: "stale-operation" };
    if (!result.ok && previous && ["select", "add", "reauthenticate"].includes(action)
      && manager.list().active === previousSlot) {
      try { recoveryFailed = !(await manager.restore()).ok; } catch { recoveryFailed = true; }
      if (disposed || token !== revision) return { ok: false, code: "stale-operation" };
    }
    let completed = null;
    if (result.ok && ["cleanup", "adopt-legacy", "initialize", "cleanup-deleted"].includes(action)) {
      completed = action;
      try { result = await manager.restore(); } catch { result = { ok: false, code: "verification-unavailable" }; }
      if (disposed || token !== revision) return { ok: false, code: "stale-operation", completed };
    }
    busy = null;
    if (result.ok && ["add", "select", "reauthenticate", "logout", "logout-game"].includes(action)) selectionVersion++;
    const list = manager.list();
    entries = result.entries?.map(entry => ({ ...entry })) ?? (list.ok ? list.entries : []);
    deletions = list.ok ? list.deletions ?? [] : [];
    pending = result.pending?.map(entry => ({ ...entry })) ?? (list.ok ? list.pending : []);
    if (!recoveryFailed && (action !== "restore" || result.ok)) installLease(token);
    // Do not turn a restore with an invalid selected session into a successful login.
    code = result.deleted || (completed === "cleanup-deleted" && result.ok) ? null : !result.ok ? result.code : !list.ok ? list.code
      : !current() ? selectedFailure(list, result) : null;
    if (!code && ["add", "select"].includes(action) && !current()) code = "stale-operation";
    phase = current() ? "ready" : code === "reauthentication-required" ? "reauthentication-required"
      : code ? "unverified" : "unselected";
    const outcome = code ? { ok: false, code } : { ok: true, code: null };
    const state = snapshot();
    emit();
    // Subscribers may synchronously request a different selection; old work must not win.
    if (token !== revision || (state.current && !current())) return { ok: false, code: "stale-operation" };
    return { ...outcome, deleted: result.deleted, completed, state };
  }
  return {
    snapshot,
    getSelectionVersion: () => selectionVersion,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    restore: () => run("restore", () => manager.restore()),
    initialize: () => run("initialize", () => manager.initialize()),
    add: (eno, password) => run("add", () => manager.add(eno, password)),
    select: eno => run("select", () => manager.select(eno)),
    reauthenticate: (eno, password) => run("reauthenticate", () => manager.reauthenticate(eno, password)),
    // Explicit handoff only. Never automatically adopt on restore or after logout.
    adoptLegacy: () => run("adopt-legacy", () => manager.adoptLegacy()),
    logoutGame: () => run("logout-game", () => manager.logoutGame()),
    logoutCurrent: () => run("logout", () => manager.logoutCurrent()),
    cleanupPending: slot => run("cleanup", () => manager.cleanupPending(slot)),
    deleteCurrent: target => run("delete", () => manager.deleteCurrent(target)),
    cleanupDeleted: target => run("cleanup-deleted", () => manager.cleanupDeleted(target)),
    getCurrent: current,
    invalidate() { manager.invalidate("explicit"); },
    dispose() {
      if (disposed) return;
      disposed = true; revision++; verified = null;
      stopInvalidation(); listeners.clear();
      document?.removeEventListener("visibilitychange", pageHidden);
      events?.removeEventListener("pagehide", pageHide);
      manager.dispose();
    },
  };
}

/** Provider closure is also injectable: tests use independent mock SDK clients, never the network. */
export function createAccountRuntimeProvider({
  loadSDK = () => import("https://esm.sh/@supabase/supabase-js@2.117.2?bundle"),
  getLegacyClient = async () => (await import("./supabaseClients.js")).getLegacySupabaseClient(),
  config = supabasePublicConfig, managerOptions = {},
} = {}) {
  let runtime;
  return function getRuntime() {
    return runtime ??= (async () => {
      const { createClient } = await loadSDK();
      const manager = createAccountSessionManager({ ...managerOptions, createClient, config, getLegacyClient });
      return createAccountRuntime({ manager, events: managerOptions.events, document: managerOptions.document, suspendOnHidden: managerOptions.suspendOnHidden });
    })().catch(error => { runtime = undefined; throw error; });
  };
}
// Importing this module alone neither creates SDK clients nor adopts any legacy session.
export const getAccountRuntime = createAccountRuntimeProvider({ managerOptions: { suspendOnHidden: false } });
