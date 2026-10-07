import { createClient } from "@supabase/supabase-js";
import { createRegistrationAdminClient } from "../_shared/admin-client.mjs";
import { createRegistrationHandler } from "../_shared/registration-handler.mjs";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("SDK contract mismatch");
}

for (const failure of [null, "access", "battler", "auth_user", "duck", "public_setting"]) {
  Deno.test("pinned SDK / mocked HTTP: " + (failure ?? "success"), async () => {
    const requests: { path: string; method: string; body: unknown; select: string | null }[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      requests.push({ path: url.pathname, method, body, select: url.searchParams.get("select") });
      const respond = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
      if (method === "DELETE") return respond({});
      if (url.pathname === "/rest/v1/game_accounts" && method === "PATCH") {
        if (failure === "public_setting") return respond({code:"23503"},400);
        return new Response(null,{status:204});
      }
      if (url.pathname === "/rest/v1/ducks") {
        if (failure === "duck") return respond({code:"23503"},400);
        return new Response(null,{status:201});
      }
      if (url.pathname === "/rest/v1/game_accounts") return respond({ eno: "123" }, 201);
      if (url.pathname === "/auth/v1/admin/users") {
        if (failure === "auth_user") return respond({ code: "email_exists", msg: "unsafe upstream text" }, 422);
        return respond({ id: "10000000-0000-4000-8000-000000000001", email: body.email }, 201);
      }
      if (url.pathname === "/rest/v1/game_account_access") {
        if (failure === "access") return respond({ code: "23503", message: "unsafe upstream text" }, 400);
        return new Response(null, { status: 201 });
      }
      if (url.pathname === "/rest/v1/battlers") {
        if (failure === "battler") return respond({ code: "23503", message: "unsafe upstream text" }, 400);
        return new Response(null, { status: 201 });
      }
      throw new Error("Unexpected SDK request");
    };
    const client = createRegistrationAdminClient(
      (name: string) => ({ SUPABASE_URL: "https://example.invalid", SUPABASE_SECRET_KEYS: '{"default":"test-key"}' }[name]),
      (url: string, key: string, options: Parameters<typeof createClient>[2]) =>
        createClient(url, key, { ...options, global: { fetch: fetchMock } }),
    );
    const handler = createRegistrationHandler({ createAdminClient: () => client });
    const response = await handler(new Request("https://example.invalid/register-account", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterName: " 名前 ", password: " untouched1 " }),
    }));
    const result = await response.json();
    equal(response.status, failure ? 502 : 201);
    equal(result, failure ? { ok: false, error: failure + "_creation_failed" } : { ok: true, eno: "123" });
    equal(requests[0].select, "eno::text");
    equal(requests[1].body, { email: "eno-123@auth.diesduck.invalid", password: " untouched1 ", email_confirm: true });
    const tablePaths = ["/rest/v1/game_accounts", "/auth/v1/admin/users", "/rest/v1/game_account_access", "/rest/v1/battlers", "/rest/v1/ducks", "/rest/v1/game_accounts"];
    equal(requests.filter(r => r.method !== "DELETE").map(r => r.path),
      tablePaths.slice(0, failure === "auth_user" ? 2 : failure === "access" ? 3 : failure === "battler" ? 4 : failure === "duck" ? 5 : 6));
    if (failure) {
      equal(requests.filter(r => r.method === "DELETE").map(r => r.path), [
        "/rest/v1/game_accounts",
        ...(failure !== "auth_user" ? ["/auth/v1/admin/users/10000000-0000-4000-8000-000000000001"] : []),
      ]);
    } else {
      equal((requests[3].body as { presentation: { name: string } }).presentation.name, "名前");
      equal((requests[4].body as { presentation: { name: string } }).presentation.name, "名前のマイアヒル");
    }
  });
}
