import { getAuthRuntime } from "./authRuntime.js";

// Subscribe to the same session notifications as the menu/guards, including logout.
getAuthRuntime().then(controller => globalThis.diesDuckSiteTheme.bindAuth(controller)).catch(() => {
  // Failed Auth initialization keeps the initial light theme.
});
