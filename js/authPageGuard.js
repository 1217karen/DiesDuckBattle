import { getAuthRuntime } from "./authRuntime.js";

// Opt in from a page's entry module, before any page initialization.
// Keep watching the shared controller after admission; logout clicks alone do nothing.
export async function requireLoginPage({ getRuntime = getAuthRuntime, document = globalThis.document,
  location = globalThis.location } = {}) {
  let admitted = false, redirected = false;
  let unsubscribe = () => {};
  const redirect = () => {
    if (redirected) return;
    redirected = true;
    document.body.classList.add("auth-required-pending");
    unsubscribe();
    location.replace(admitted ? "index.html" : "index.html?notice=login-required");
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
          redirect();
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
