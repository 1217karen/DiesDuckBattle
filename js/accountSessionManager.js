import { canonicalEno, internalEmailForEno } from "../supabase/functions/_shared/internal-email.mjs";

export const SESSION_REGISTRY_KEY = "diesduck-account-sessions-v1";
export const LEGACY_SESSION_KEY = "diesduck-auth-session";
const PREFIX = "diesduck-auth-account-v1-";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail = code => ({ ok: false, code });
const abort = code => { throw Object.assign(new Error(code), { code }); };
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join() === [...keys].sort().join();
function decode(raw) {
  if (raw === null) return { version: 1, entries: [], pending: [], active: null };
  let value;
  try { value = JSON.parse(raw); } catch { abort("invalid-registry"); }
  if (!exact(value, ["version", "entries", "pending", "active"]) || value.version !== 1 || !Array.isArray(value.entries)
    || value.entries.length > 50 || !Array.isArray(value.pending) || value.pending.length > 50) abort("invalid-registry");
  const slots = new Set(), enos = new Set();
  for (const entry of value.entries) {
    if (!exact(entry, ["slot", "eno", "name"]) || !(UUID.test(entry.slot) || entry.slot === "legacy")
      || typeof entry.eno !== "string" || typeof entry.name !== "string" || entry.name.length > 200) abort("invalid-registry");
    try { if (canonicalEno(entry.eno) !== entry.eno) abort("invalid-registry"); } catch { abort("invalid-registry"); }
    if (slots.has(entry.slot) || enos.has(entry.eno)) abort("invalid-registry");
    slots.add(entry.slot); enos.add(entry.eno);
  }
  for (const item of value.pending) {
    if (!exact(item, ["slot", "eno"]) || !UUID.test(item.slot) || slots.has(item.slot)
      || typeof item.eno !== "string") abort("invalid-registry");
    try { if (canonicalEno(item.eno) !== item.eno) abort("invalid-registry"); } catch { abort("invalid-registry"); }
    slots.add(item.slot);
  }
  if (value.active !== null && !value.entries.some(entry => entry.slot === value.active)) abort("invalid-registry");
  return value;
}

/** Stage 1 only. Not imported by authRuntime or production page entry points.
 * createClient is the pinned SDK factory; SDK alone owns tokens in its storage.
 * One manager per page; Web Locks serialize registry operations across tabs.
 */
export function createAccountSessionManager({ createClient, config,
  storage = () => globalThis.localStorage, locks = globalThis.navigator?.locks,
  events = globalThis.window, randomUUID = () => globalThis.crypto.randomUUID(),
  getLegacyClient,
}) {
  const clients = new Map(), subscriptions = new Map();
  let generation = 0, leaseEpoch = 0, closed = false, activeLease = null;
  const invalidationListeners = new Set();
  const invalidate = (reason = "invalidated") => {
    generation++; leaseEpoch++; activeLease = null;
    for (const listener of invalidationListeners) {
      try { listener(reason); } catch { /* Observers do not own session state. */ }
    }
  };
  const onStorage = event => {
    if (event.key === null || event.key === SESSION_REGISTRY_KEY || event.key === LEGACY_SESSION_KEY
      || event.key?.startsWith(PREFIX)) invalidate("storage");
  };
  events?.addEventListener("storage", onStorage);
  const onPageShow = () => invalidate("pageshow");
  events?.addEventListener("pageshow", onPageShow);
  function read() {
    try { const raw = storage().getItem(SESSION_REGISTRY_KEY); return { raw, value: decode(raw) }; }
    catch (error) { if (error.code === "invalid-registry") throw error; abort("storage-unavailable"); }
  }
  function write(value) {
    try { storage().setItem(SESSION_REGISTRY_KEY, JSON.stringify(value)); }
    catch { abort("storage-unavailable"); }
  }
  async function clientFor(slot) {
    if (!clients.has(slot)) {
      if (slot === "legacy") {
        if (!getLegacyClient) abort("legacy-handoff-required");
        clients.set(slot, await getLegacyClient());
      } else {
        if (!UUID.test(slot)) abort("invalid-registry");
        clients.set(slot, createClient(config.url, config.publishableKey, { auth: {
          persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
          storageKey: PREFIX + slot, storage: storage(),
        } }));
      }
    }
    if (!subscriptions.has(slot)) {
      const client = clients.get(slot);
      const { data } = client.auth.onAuthStateChange((event, session) => {
        // No asynchronous SDK calls inside the Auth lock.
        if (activeLease?.client === client && (event === "SIGNED_OUT"
          || session?.user?.id !== activeLease.account.authUserId)) invalidate("auth");
      });
      subscriptions.set(slot, data.subscription);
    }
    return clients.get(slot);
  }
  async function verify(client, expectedEno) {
    const clearLease = () => { if (activeLease?.client === client) { leaseEpoch++; activeLease = null; } };
    const before = await client.auth.getUser();
    if (before.error) {
      const reauthenticate = [401, 403].includes(before.error.status)
        || ["session_not_found", "refresh_token_not_found", "refresh_token_already_used"].includes(before.error.code)
        || before.error.name === "AuthSessionMissingError";
      if (reauthenticate) clearLease();
      abort(reauthenticate ? "reauthentication-required" : "verification-unavailable");
    }
    if (!before.data?.user?.id) { clearLease(); abort("reauthentication-required"); }
    const user = before.data.user;
    const rows = await client.from("game_account_access")
      .select("game_account_id,game_accounts!inner(eno::text,battlers(presentation))").eq("auth_user_id", user.id);
    if (rows.error || !Array.isArray(rows.data)) abort("verification-unavailable");
    // Legacy adoption has no trusted target: never choose the first of multiple accounts.
    if (expectedEno === undefined && rows.data.length !== 1) abort("ambiguous-account");
    const matches = rows.data.filter(row => canonicalEno(row.game_accounts?.eno) === (expectedEno ?? canonicalEno(rows.data[0].game_accounts?.eno)));
    if (matches.length !== 1) abort("eno-mismatch");
    const row = matches[0], eno = canonicalEno(row.game_accounts.eno);
    if (user.email !== internalEmailForEno(eno) || typeof row.game_account_id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.game_account_id)) abort("eno-mismatch");
    const after = await client.auth.getUser();
    if (after.error || after.data?.user?.id !== user.id || after.data?.user?.email !== user.email) { clearLease(); abort("session-changed"); }
    const name = row.game_accounts.battlers?.presentation?.name;
    return { authUserId: user.id, eno, name: typeof name === "string" ? name.slice(0, 200) : "", gameAccountId: row.game_account_id };
  }
  function operation(work) {
    const intent = ++generation; // A newer selection cancels older network results on this page.
    if (closed) return Promise.resolve(fail("closed"));
    if (!locks?.request) return Promise.resolve(fail("locking-unavailable"));
    return locks.request(SESSION_REGISTRY_KEY, { mode: "exclusive" }, async () => {
      const { raw, value } = read();
      const check = () => {
        if (closed || intent !== generation || read().raw !== raw) abort("stale-operation");
      };
      check();
      return work(value, check, intent);
    }).catch(error => fail(error.code ?? "verification-unavailable"));
  }
  function lease(client, account, slot) {
    const raw = read().raw, revision = ++leaseEpoch;
    const result = { client, account: { ...account }, isCurrent() {
      try { return !closed && revision === leaseEpoch && read().raw === raw && activeLease === result; }
      catch { return false; }
    } };
    activeLease = result;
    return { ok: true, account: { ...account }, slot };
  }
  async function discard(client) {
    try { const result = await client.auth.signOut({ scope: "local" }); return !result.error; }
    catch { return false; }
  }
  return {
    // Listing is display-only. No cached entry grants access to a client.
    list() {
      try { return { ok: true, ...read().value, entries: read().value.entries.map(entry => ({ ...entry })) }; }
      catch (error) { return fail(error.code); }
    },
    add(eno, password) {
      return operation(async (registry, check) => {
        try { eno = canonicalEno(eno); } catch { return fail("invalid-eno"); }
        if (typeof password !== "string" || !password) return fail("invalid-password");
        if (registry.entries.some(entry => entry.eno === eno)) return fail("already-added");
        if (registry.entries.length >= 50) return fail("account-limit");
        if (registry.pending.length) return fail("cleanup-required");
        // Journal only slot/ENo before creating a session, so interrupted adds can be cleaned after reload.
        const slot = randomUUID();
        if (!UUID.test(slot) || clients.has(slot) || registry.entries.some(entry => entry.slot === slot)
          || storage().getItem(PREFIX + slot) !== null) abort("slot-collision");
        registry.pending.push({ slot, eno }); write(registry);
        const baseline = read().raw, token = generation;
        check = () => { if (closed || generation !== token || read().raw !== baseline) abort("stale-operation"); };
        const client = await clientFor(slot);
        let committed = false;
        try {
          const signed = await client.auth.signInWithPassword({ email: internalEmailForEno(eno), password });
          password = undefined;
          if (signed.error || !signed.data?.session) abort("login-failed");
          check();
          const account = await verify(client, eno); check();
          registry.pending = registry.pending.filter(item => item.slot !== slot);
          registry.entries.push({ slot, eno, name: account.name }); registry.active = slot;
          write(registry); committed = true;
          return lease(client, account, slot);
        } catch (error) {
          const cleaned = await discard(client);
          if (cleaned && read().raw === baseline) {
            const current = read().value;
            current.pending = current.pending.filter(item => item.slot !== slot);
            try { write(current); } catch { return fail("cleanup-required"); }
          }
          return fail(cleaned ? (error.code ?? "verification-unavailable") : "cleanup-required");
        } finally {
          password = undefined;
          if (!committed) { subscriptions.get(slot)?.unsubscribe(); subscriptions.delete(slot);
          client.auth.stopAutoRefresh?.(); clients.delete(slot); }
        }
      });
    },
    cleanupPending(slot) {
      return operation(async (registry, check) => {
        const entry = registry.pending.find(item => item.slot === slot);
        if (!entry) return fail("not-pending");
        const client = await clientFor(slot);
        const user = await client.auth.getUser();
        if (!user.error && user.data?.user) {
          await verify(client, entry.eno);
          check();
          if (!await discard(client)) return fail("cleanup-required");
        } else {
          // Only an explicit missing-user result is eligible for local absence confirmation.
          // Network/refresh errors must not become permission to remove the recovery journal.
          const missing = user.data?.user === null && (!user.error
            || user.error.name === "AuthSessionMissingError");
          if (!missing) return fail("verification-unavailable");
          const session = await client.auth.getSession();
          if (session.error || session.data?.session !== null) return fail("verification-unavailable");
          // No session exists: do not send a sign-out request at all.
        }
        check(); registry.pending = registry.pending.filter(item => item.slot !== slot); write(registry);
        subscriptions.get(slot)?.unsubscribe(); subscriptions.delete(slot);
        client.auth.stopAutoRefresh?.(); clients.delete(slot);
        return { ok: true };
      });
    },
    select(eno) {
      return operation(async (registry, check) => {
        const entry = registry.entries.find(item => item.eno === eno);
        if (!entry) return fail("not-added");
        const client = await clientFor(entry.slot), account = await verify(client, entry.eno); check();
        entry.name = account.name; registry.active = entry.slot; write(registry);
        return lease(client, account, entry.slot);
      });
    },
    restore() {
      return operation(async (registry, check) => {
        const entries = []; let verified;
        for (const entry of registry.entries) {
          try {
            const client = await clientFor(entry.slot), account = await verify(client, entry.eno); check();
            entries.push({ ...entry, name: account.name, status: "ready" });
            if (registry.active === entry.slot) verified = { client, account, slot: entry.slot };
          } catch (error) { check(); entries.push({ ...entry, status: error.code ?? "verification-unavailable" }); }
        }
        check(); activeLease = null;
        if (verified) lease(verified.client, verified.account, verified.slot);
        return { ok: true, entries, pending: registry.pending.map(item => ({ ...item })), active: verified?.account.eno ?? null };
      });
    },
    adoptLegacy() {
      return operation(async (registry, check) => {
        if (registry.entries.some(entry => entry.slot === "legacy")) return fail("already-added");
        const client = await clientFor("legacy"), account = await verify(client); check();
        if (registry.entries.some(entry => entry.eno === account.eno)) return fail("already-added");
        if (registry.entries.length >= 50) return fail("account-limit");
        registry.entries.push({ slot: "legacy", eno: account.eno, name: account.name });
        // Preserve an existing selection. Adoption is explicit and never copies/removes old tokens.
        if (registry.active === null && registry.entries.length === 1) registry.active = "legacy";
        write(registry);
        if (registry.active === "legacy") return lease(client, account, "legacy");
        return { ok: true, account };
      });
    },
    logoutCurrent() {
      return operation(async (registry, check) => {
        const entry = registry.entries.find(item => item.slot === registry.active);
        if (!entry) return fail("no-selection");
        const client = await clientFor(entry.slot); await verify(client, entry.eno); check();
        // Irreversible request starts only after identity and intent checks.
        const beforeLogout = read().raw;
        activeLease = null;
        let signedOut;
        try { signedOut = await client.auth.signOut({ scope: "local" }); } catch { return fail("logout-unknown"); }
        if (signedOut.error) { activeLease = null; return fail("logout-unknown"); }
        activeLease = null;
        // Even if a new local selection was requested while signOut ran, reconcile this slot
        // under the cross-tab lock, before that later operation reads the registry.
        if (read().raw !== beforeLogout) return fail("logout-unknown");
        registry.entries = registry.entries.filter(item => item.slot !== entry.slot); registry.active = null;
        try { write(registry); } catch { return fail("logout-unknown"); }
        return { ok: true, active: null };
      });
    },
    subscribeInvalidation(listener) { invalidationListeners.add(listener); return () => invalidationListeners.delete(listener); },
    getActiveLease() { return activeLease?.isCurrent() ? activeLease : null; },
    invalidate,
    dispose() {
      closed = true; invalidate("closed"); invalidationListeners.clear();
      events?.removeEventListener("storage", onStorage); events?.removeEventListener("pageshow", onPageShow);
      for (const subscription of subscriptions.values()) subscription.unsubscribe();
      subscriptions.clear();
      // Never stop the shared legacy runtime's refresh loop.
      for (const [slot, client] of clients) if (slot !== "legacy") client.auth.stopAutoRefresh?.();
    },
  };
}
