import { createClient } from "@supabase/supabase-js";
import { createRegistrationAdminClient } from "../_shared/admin-client.mjs";
import { createRegistrationHandler } from "../_shared/registration-handler.mjs";

Deno.serve(createRegistrationHandler({
  createAdminClient: () => createRegistrationAdminClient(
    (name: string) => Deno.env.get(name), createClient,
  ),
  log: (event: string, context: Record<string, string>) => console.error(event, context),
}));
