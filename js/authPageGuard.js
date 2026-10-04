import { getAuthRuntime } from "./authRuntime.js";

// Opt in from a page's entry module, before any page initialization.
// Keep watching the shared controller after admission; logout clicks alone do nothing.
export async function requireLoginPage({ getRuntime = getAuthRuntime, document = globalThis.document,
  location = globalThis.location } = {}) {
  let admitted = false, redirected = false;
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
        if (!state.sessionKnown) {
          if (!state.ready) return;
          redirect();
          reject(new Error("Auth state could not be confirmed"));
          return;
        }
        if (!state.signedIn) {
          // Auth's SIGNED_OUT event can precede the logout promise's outcome.
          // Hide immediately, but let the action settle before choosing its notice.
          if (admitted && state.busy === "logout") {
            document.body.classList.add("auth-required-pending");
            return;
          }
          redirect(!admitted ? "index.html?notice=login-required"
            : state.logoutSucceeded ? "index.html?notice=logged-out" : "index.html");
          reject(new Error("Login required"));
          return;
        }
        if (!admitted) {
          admitted = true;
          document.body.classList.remove("auth-required-pending");
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
