/** Integration boundary for account-bound page operations.
 * Not enabled by production entry points until every caller has migrated.
 * Session ownership/validation remains exclusively in accountRuntime/manager.
 */
export function createAccountOperationCoordinator(runtime) {
  const guards = new Set();
  let writes = 0, changing = false, closed = false;
  const failure = code => ({ ok: false, code });
  const scope = () => {
    const current = runtime.getCurrent();
    if (!current?.isCurrent()) return null;
    return { client: current.client, account: Object.freeze({ ...current.account }),
      isCurrent: () => !closed && current.isCurrent() };
  };
  const same = (before, after) => before === null ? after === null : !!after
    && before.isCurrent() && before.client === after.client
    && before.account.eno === after.account.eno
    && before.account.gameAccountId === after.account.gameAccountId
    && before.account.authUserId === after.account.authUserId;
  async function execute(writing, work) {
    if (closed) return failure("closed");
    if (changing) return failure("account-change-in-progress");
    const context = scope();
    if (!context) return failure("account-unverified");
    if (writing) writes++;
    try {
      // The callback receives a fixed client/ID pair, never a dynamic client getter.
      // Both reads and writes must explicitly pass context.account.gameAccountId.
      if (!context.isCurrent()) return failure("stale-operation");
      const value = await work(Object.freeze(context));
      if (!context.isCurrent()) return failure(writing ? "write-unknown" : "stale-operation");
      return { ok: true, value, account: context.account };
    } catch {
      return failure(writing ? "write-unknown" : "request-failed");
    } finally { if (writing) writes--; }
  }
  async function change(method, args) {
    if (closed) return failure("closed");
    if (changing || writes) return failure("operation-in-progress");
    changing = true; // Also blocks writes while an asynchronous unsaved-change dialog is open.
    const previous = scope();
    try {
      for (const guard of guards) {
        if (!await guard({ action: method })) return failure("cancelled");
        if (closed || !same(previous, scope())) return failure("stale-operation");
      }
      if (closed || writes || !same(previous, scope())) return failure("stale-operation");
      return await runtime[method](...args);
    } catch { return failure("account-change-failed"); }
    finally { changing = false; }
  }
  return {
    // Register existing canLeave() and any page-specific draft/transaction guard here.
    beforeAccountChange(guard) { guards.add(guard); return () => guards.delete(guard); },
    read: work => execute(false, work),
    write: work => execute(true, work),
    add: (eno, password) => change("add", [eno, password]),
    select: eno => change("select", [eno]),
    reauthenticate: (eno, password) => change("reauthenticate", [eno, password]),
    cleanupDeleted: target => change("cleanupDeleted", [target]),
    cleanupPending: slot => change("cleanupPending", [slot]),
    logoutGame: () => change("logoutGame", []),
    logoutCurrent: () => change("logoutCurrent", []),
    snapshot: () => ({ changing, writes, closed }),
    dispose() { closed = true; guards.clear(); },
  };
}
