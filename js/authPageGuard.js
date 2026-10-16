import { getAuthRuntime } from "./authRuntime.js";

// Opt in from a page's entry module, before any page initialization.
// Keep watching the shared controller after admission; logout clicks alone do nothing.
export async function requireLoginPage({ getRuntime = getAuthRuntime, document = globalThis.document,
  location = globalThis.location } = {}) {
  let admitted = false, redirected = false, admittedEno;
  let unsubscribe = () => {};
  const redirect = (target = "index.html") => {
    if (redirected) return;
    redirected = true;
    document.body.classList.add("auth-required-pending");
    unsubscribe();
    location.replace(target);
  };
  try {
    const auth = await getRuntime();
    await new Promise((resolve, reject) => {
      unsubscribe = auth.subscribe(state => {
        if (redirected) return;
        // Only an already-admitted page may wait for a local account operation.
        // Hide before checking sessionKnown: runtime intentionally withdraws its lease.
        if (admitted && state.accountSwitching && (state.accountNavigationPending
          || ["select", "login"].includes(state.busy)
          || (state.busy === "logout" && !state.signedIn))) {
          document.body.classList.add("auth-required-pending");
          return;
        }
        if (admitted && !state.signedIn) document.body.classList.add("auth-required-pending");
        if (!state.sessionKnown) {
          if (!state.ready) return;
          redirect();
          reject(new Error("Auth state could not be confirmed"));
          return;
        }
        if (!state.signedIn) {
          // Auth's SIGNED_OUT event can precede the logout promise's outcome.
          // Hide immediately, but let the action settle before choosing its notice.
          if (admitted && (state.busy === "logout" || state.accountDeletionPending)) {
            document.body.classList.add("auth-required-pending");
            return;
          }
          redirect(!admitted ? "index.html?notice=login-required"
            : state.accountDeletionSucceeded ? "index.html?notice=account-deleted"
              : state.logoutSucceeded ? "index.html?notice=logged-out" : "index.html");
          reject(new Error("Login required"));
          return;
        }
        if (admitted && state.accountSwitching && state.enos?.[0] !== admittedEno) {
          redirect(); // An external identity change cannot reveal the old page under a new ENo.
          return;
        }
        document.body.classList.remove("auth-required-pending");
        if (!admitted) {
          admitted = true; admittedEno = state.enos?.[0];
          resolve();
        }
      });
      // subscribe immediately emits a snapshot, before it returns its disposer.
      if (redirected) unsubscribe();
    });
  } catch (error) {
    redirect();
    throw error; // A redirect must never allow the awaiting page to initialize.
  }
}
