import { showToast } from "./toast.js";
import { supabasePublicConfig } from "./supabasePublicConfig.js";
import { createAuthService } from "./authService.js";
import { createAuthController } from "./authController.js";
import { getLegacySupabaseClient } from "./supabaseClients.js";
import { getPublicSupabaseClient } from "./supabaseClients.js";
import { ACCOUNT_SWITCHING_ENABLED } from "./accountSwitchingConfig.js";
import { getAccountRuntime } from "./accountRuntime.js";
import { createAccountAuthController } from "./accountAuthController.js";
import { displayCache } from "./authDisplayCache.js";

// One SDK client/session key, shared by menu, forms and online editors on this page.
let runtime;
let multi, initialized;
async function getMultiRuntime() {
  return multi ??= (async () => {
    const accounts = await getAccountRuntime();
    const controller = createAccountAuthController({ runtime: accounts,
      registrationService: createAuthService({ config: supabasePublicConfig }),
      notify: message => showToast({ kind: "success", message }),
      clearCache: () => displayCache.clear(), navigate: url => location.assign(url) });
    initialized = controller.start();
    let resuming = false;
    const reloadSuspendedPage = () => {
      if (resuming || accounts.snapshot().phase !== "suspended") return;
      resuming = true;
      location.reload();
    };
    window.addEventListener("pageshow", event => { if (event.persisted) reloadSuspendedPage(); });
    // Used if this runtime is configured to suspend leases in hidden tabs.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "hidden") reloadSuspendedPage();
    });
    return controller;
  })();
}
export async function getSupabaseClient() {
  if (ACCOUNT_SWITCHING_ENABLED) {
    const controller = await getMultiRuntime(); await initialized;
    const client = controller.getClient();
    if (client) return client;
    // Public reads never inherit a previously selected account's credentials.
    return getPublicSupabaseClient();
  }
  return getLegacySupabaseClient();
}
export function getAuthRuntime() {
  if (ACCOUNT_SWITCHING_ENABLED) return getMultiRuntime();
  return runtime ??= (async () => {
    const client = await getSupabaseClient();
    const controller = createAuthController(createAuthService({ client, config: supabasePublicConfig }), () => {}, message => showToast({ kind: "success", message }));
    // Return the controller before restore completes, so every subscriber sees loading.
    void controller.start();
    return controller;
  })();
}
