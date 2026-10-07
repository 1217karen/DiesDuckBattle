import test from "node:test";
import assert from "node:assert/strict";
import { canonicalEno, internalEmailForEno } from "../supabase/functions/_shared/internal-email.mjs";
import { registerAccount } from "../supabase/functions/_shared/registration.mjs";
import { createRegistrationHandler } from "../supabase/functions/_shared/registration-handler.mjs";
import { createRegistrationAdminClient } from "../supabase/functions/_shared/admin-client.mjs";
import { decodeOnlinePlayer } from "../js/onlinePlayerDto.js";
import { inspectBattleLoadout } from "../js/battleLoadoutCompiler.js";
import { duckNameError } from "../js/nameValidation.js";

const input = { characterName: "  テスト  ", password: "  unchanged-password1  " };
const id = "20000000-0000-4000-8000-000000000001";
const duckId = "30000000-0000-4000-8000-000000000001";
const authId = "10000000-0000-4000-8000-000000000001";

function fixture({ fail, throws = false, cleanupFails = [], eno = "123", errorCode } = {}) {
  const calls = [], logs = [];
  const op = async (name, value, data = null) => {
    calls.push([name, value]);
    if (name === fail || cleanupFails.includes(name)) {
      const error = { code: errorCode, message: input.password, details: "secret-value" };
      if (throws) throw error;
      return { data: null, error };
    }
    return { data, error: null };
  };
  const client = {
    from(table) {
      return {
        insert(value) {
          if (table === "game_accounts") return {
            select(columns) {
              assert.equal(columns, "eno::text");
              return { single: () => op("game_account", value, { eno }) };
            },
          };
          if (table === "game_account_access") return op("access", value);
          if (table === "ducks") return op("duck", value);
          if (table === "battlers") return op("battler", value);
          assert.fail("Unexpected table: " + table);
        },
        update(value) { return { eq: () => op("public_setting", value) }; },
        delete() {
          assert.equal(table, "game_accounts");
          return { eq: (column, value) => {
            assert.equal(column, "id");
            return op("cleanup_account", value);
          } };
        },
      };
    },
    auth: { admin: {
      createUser: value => op("auth_user", value, { user: { id: authId } }),
      deleteUser: value => op("cleanup_auth", value),
    } },
  };
  let serial = 0;
  return { client, calls, logs, uuid: () => serial++ === 0 ? id : duckId, log: (...args) => logs.push(args) };
}
const names = f => f.calls.map(c => c[0]);

test("registration stores a normal current DTO with a public incomplete Duck and full 21-character name", async () => {
  const f=fixture(), name='😀'.repeat(15);
  assert.equal((await registerAccount({...input,characterName:name},f)).status,201);
  const battler=f.calls.find(([stage])=>stage==='battler')[1];
  const duck=f.calls.find(([stage])=>stage==='duck')[1];
  const data=decodeOnlinePlayer({battler:{build:battler.build,presentation:battler.presentation},
    ducks:[{id:duck.id,build:duck.build,presentation:duck.presentation}],publicDuckId:duck.id});
  assert.equal(data.build.ducks.length,1);assert.equal(data.build.ducks[0].name,name+'のマイアヒル');
  assert.equal(duckNameError(data.build.ducks[0].name),'');
  assert.equal(data.publicSettings.publicDuckId,duck.id);
  assert.equal(inspectBattleLoadout(data.build,duck.id).ready,false);
});

test("registration creates account, confirmed Auth user, access, named Battler, first Duck and public setting in order", async () => {
  const f = fixture();
  const result = await registerAccount(input, f);
  assert.deepEqual(result, { status: 201, body: { ok: true, eno: "123" } });
  assert.deepEqual(names(f), ["game_account", "auth_user", "access", "battler", "duck", "public_setting"]);
  assert.deepEqual(f.calls[0][1], { id });
  assert.deepEqual(f.calls[1][1], {
    email: internalEmailForEno("123"), password: input.password, email_confirm: true,
  });
  assert.deepEqual(f.calls[2][1], { auth_user_id: authId, game_account_id: id });
  assert.equal(f.calls[3][1].presentation.name, "テスト");
  assert.equal(f.calls[4][1].presentation.name, "テストのマイアヒル");
  assert.equal(f.calls[4][1].id, duckId);
  assert.deepEqual(f.calls[5][1], { public_duck_id: duckId });
  assert.deepEqual(f.logs, []);
  assert.ok(!JSON.stringify(result).includes(input.password));
  assert.ok(!JSON.stringify(result).includes("@"));
});

for (const invalid of [null, [], {}, { characterName: "", password: "" },
  { characterName: " \n ", password: "p" }, { characterName: 42, password: "p" },
  { characterName: {}, password: "p" }, { characterName: "n", password: null },
  { characterName: "n", password: 42 }, { characterName: "n" }]) {
  test("invalid input rejected without side effects: " + JSON.stringify(invalid), async () => {
    const f = fixture();
    assert.equal((await registerAccount(invalid, f)).status, 400);
    assert.deepEqual(f.calls, []);
  });
}
test("six-character password is passed unmodified; duplicate names allowed", async () => {
  for (let i = 0; i < 2; i++) {
    const f = fixture();
    assert.equal((await registerAccount({ ...input, password: " a1   " }, f)).status, 201);
    assert.equal(f.calls[1][1].password, " a1   ");
  }
});
test("deterministic internal email, canonical decimal ENo, exact bigint range", () => {
  assert.equal(internalEmailForEno(123), "eno-123@auth.diesduck.invalid");
  assert.equal(internalEmailForEno("000123"), internalEmailForEno("123"));
  assert.notEqual(internalEmailForEno(123), internalEmailForEno(124));
  assert.equal(canonicalEno("9223372036854775807"), "9223372036854775807");
  for (const v of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1@evil", "1e3", "", "9223372036854775808", null]) {
    assert.throws(() => internalEmailForEno(v));
  }
});
test("large database ENo is not rounded in Auth identity or response", async () => {
  const f = fixture({ eno: "9223372036854775807" });
  const r = await registerAccount(input, f);
  assert.equal(r.body.eno, "9223372036854775807");
  assert.equal(f.calls[1][1].email, internalEmailForEno(r.body.eno));
});

for (const fail of ["game_account", "auth_user", "access", "battler", "duck", "public_setting"]) {
  for (const throws of [false, true]) {
    test(fail + " failure compensates returned errors and thrown exceptions: " + throws, async () => {
      const f = fixture({ fail, throws });
      const r = await registerAccount(input, f);
      assert.equal(r.body.error, fail + "_creation_failed");
      const steps = ["game_account", "auth_user", "access", "battler", "duck", "public_setting"];
      assert.deepEqual(names(f), [...steps.slice(0, steps.indexOf(fail) + 1),
        "cleanup_account", ...(["access", "battler", "duck", "public_setting"].includes(fail) ? ["cleanup_auth"] : [])]);
      assert.equal(f.calls.find(c => c[0] === "cleanup_account")[1], id);
      const visible = JSON.stringify([r, f.logs]);
      assert.ok(!visible.includes(input.password));
      assert.ok(!visible.includes("secret-value"));
      assert.ok(!visible.includes("@auth."));
    });
  }
}
for (const throws of [false, true]) {
  test("cleanup failures never replace original error and both cleanups are attempted: " + throws, async () => {
    const f = fixture({ fail: "battler", throws, cleanupFails: ["cleanup_account", "cleanup_auth"] });
    const r = await registerAccount(input, f);
    assert.equal(r.body.error, "battler_creation_failed");
    assert.deepEqual(names(f).slice(-2), ["cleanup_account", "cleanup_auth"]);
    assert.deepEqual(f.logs.map(x => x[0]), ["registration_failed", "registration_cleanup_failed", "registration_cleanup_failed"]);
    assert.ok(!JSON.stringify(f.logs).includes(input.password));
  });
}
test("logging failure does not prevent cleanup", async () => {
  const f = fixture({ fail: "access" });
  f.log = () => { throw new Error(input.password); };
  assert.equal((await registerAccount(input, f)).body.error, "access_creation_failed");
  assert.deepEqual(names(f).slice(-2), ["cleanup_account", "cleanup_auth"]);
});
test("identity conflict fails without retry or attaching/deleting existing user", async () => {
  const f = fixture({ fail: "auth_user", errorCode: "email_exists" });
  assert.equal((await registerAccount(input, f)).status, 502);
  assert.deepEqual(names(f), ["game_account", "auth_user", "cleanup_account"]);
});
test("Auth password rejection gives fixed 400 error and cleans account", async () => {
  const f = fixture({ fail: "auth_user", errorCode: "weak_password" });
  assert.deepEqual(await registerAccount(input, f), {
    status: 400, body: { ok: false, error: "password_rejected" },
  });
});

const request = (body, method = "POST", type = "application/json") => new Request("https://example.invalid/register-account", {
  method, headers: { "content-type": type }, ...(method === "POST" ? { body } : {}),
});
test("HTTP success returns only ok/eno, no-store and CORS", async () => {
  const f = fixture();
  const handler = createRegistrationHandler({ ...f, createAdminClient: () => f.client });
  const response = await handler(request(JSON.stringify(input)));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, eno: "123" });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});
test("HTTP preflight/method/media type/JSON/shape errors never initialize admin", async () => {
  const handler = createRegistrationHandler({ createAdminClient: () => assert.fail("Admin must not initialize") });
  for (const [req, status] of [
    [request(null, "OPTIONS"), 204], [request(null, "GET"), 405],
    [request("{}", "POST", "text/plain"), 415], [request("{"), 400],
    [request("null"), 400], [request(JSON.stringify({ password: input.password })), 400],
  ]) {
    const response = await handler(req);
    assert.equal(response.status, status);
    assert.ok(!((await response.text()).includes(input.password)));
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  }
});
test("HTTP configuration errors are sanitized", async () => {
  const logs = [];
  const handler = createRegistrationHandler({
    createAdminClient: () => { throw new Error("secret-value " + input.password); },
    log: (...x) => logs.push(x),
  });
  const r = await handler(request(JSON.stringify(input)));
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { ok: false, error: "registration_unavailable" });
  assert.deepEqual(logs, [["registration_unavailable", {}]]);
});
test("secret key dictionary preferred; explicit legacy fallback; sessions disabled", () => {
  const create = (...args) => args;
  const env = { SUPABASE_URL: "https://example.invalid", SUPABASE_SECRET_KEYS: '{"default":"test-secret"}',
    SUPABASE_SERVICE_ROLE_KEY: "legacy-test-key" };
  const read = key => env[key];
  const args = createRegistrationAdminClient(read, create);
  assert.equal(args[1], "test-secret");
  assert.deepEqual(args[2], { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  delete env.SUPABASE_SECRET_KEYS;
  assert.equal(createRegistrationAdminClient(read, create)[1], "legacy-test-key");
  env.SUPABASE_SECRET_KEYS = "{";
  assert.throws(() => createRegistrationAdminClient(read, create));
  delete env.SUPABASE_SECRET_KEYS;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  assert.throws(() => createRegistrationAdminClient(read, create));
});
