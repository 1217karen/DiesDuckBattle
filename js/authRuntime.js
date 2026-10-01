import { showToast } from "./toast.js";
import { supabasePublicConfig } from "./supabasePublicConfig.js";
import { createAuthService } from "./authService.js";
import { createAuthController } from "./authController.js";

// One SDK client/session key, shared by menu, forms and online editors on this page.
let runtime, clientPromise;
export function getSupabaseClient() {
  return clientPromise ??= (async () => {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.117.2?bundle");
    return createClient(supabasePublicConfig.url, supabasePublicConfig.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
        storageKey: "diesduck-auth-session" },
    });
  })();
}
export function getAuthRuntime() {
  return runtime ??= (async () => {
    const client = await getSupabaseClient();
    const controller = createAuthController(createAuthService({ client, config: supabasePublicConfig }), () => {}, message => showToast({ kind: "success", message }));
    // Return the controller before restore completes, so every subscriber sees loading.
    void controller.start();
    return controller;
  })();
}
