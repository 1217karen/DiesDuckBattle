import { ACCOUNT_SWITCHING_ENABLED } from "./accountSwitchingConfig.js";
// Display-only data. Never consult this cache for authorization or page admission.
// Module bootstrap runs before the auth runtime/SDK; the shared flag is the only source.
(() => {
  const key = "diesduck-menu-display-v1";
  const valid = value => value && value.version === 1 && typeof value.loggedIn === "boolean"
    && typeof value.identity === "string" && value.identity.length <= 2048
    && Object.keys(value).length === 3;
  const cache = {
    read() {
      try {
        const value = JSON.parse(globalThis.sessionStorage.getItem(key));
        return valid(value) ? value : null;
      } catch { return null; }
    },
    write(value) {
      // Whitelist fields: callers cannot persist session/UUID/credential properties.
      const entry = { version: 1, loggedIn: value.loggedIn, identity: value.identity };
      if (!valid(entry)) return;
      try { globalThis.sessionStorage.setItem(key, JSON.stringify(entry)); } catch { /* Optional display cache. */ }
    },
    clear() {
      try { globalThis.sessionStorage.removeItem(key); } catch { /* Optional display cache. */ }
    },
  };
  globalThis.diesDuckMenuDisplayCache = cache;
  if (!ACCOUNT_SWITCHING_ENABLED) {
    const label = globalThis.document?.getElementById("common-menu")?.querySelector("[data-identity]");
    const saved = cache.read();
    if (label && saved && label.textContent !== saved.identity) { label.textContent = saved.identity; label.title = saved.identity; }
  }
})();
