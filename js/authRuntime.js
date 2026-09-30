import { supabasePublicConfig } from "./supabasePublicConfig.js";
import { createAuthService } from "./authService.js";
import { createAuthController } from "./authController.js";

// One SDK client, one auth subscription, shared by menu and forms on this page.
let runtime;
export function getAuthRuntime() {
  return runtime ??= (async () => {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.117.2?bundle");
    const client = createClient(supabasePublicConfig.url, supabasePublicConfig.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
        storageKey: "diesduck-auth-session" },
    });
    const controller = createAuthController(createAuthService({ client, config: supabasePublicConfig }), () => {});
    // Return the controller before restore completes, so every subscriber sees loading.
    void controller.start();
    return controller;
  })();
}
