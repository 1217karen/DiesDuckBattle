import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAuthService, registrationInput, authMessages } from "../js/authService.js";
import { createAuthController } from "../js/authController.js";
import { authMarkup } from "../js/authMarkup.js";
import { internalEmailForEno } from "../supabase/functions/_shared/internal-email.mjs";

const config = { url: "https://example.invalid", publishableKey: "public-test-key" };
const input = { characterName: " 名前 ", password: " password1 with spaces ", confirmation: " password1 with spaces " };
const session = { user: { id: "auth-uuid" } };
function setup({ rows = [{ game_account_id: "different-game-uuid", game_accounts: { eno: "123" } }] } = {}) {
  const calls = [];
  let callback;
  const client = {
    auth: {
      signInWithPassword: async body => { calls.push(["login", body]); return { data: { session } }; },
      getSession: async () => ({ data: { session } }),
      signOut: async options => { calls.push(["logout", options]); return {}; },
      onAuthStateChange: fn => { callback = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    },
    from: table => ({ select: query => ({ eq: async (field, value) => {
      calls.push(["query", table, query, field, value]); return { data: rows };
    } }) }),
  };
  const service = createAuthService({ client, config, fetchImpl: async (...args) => {
    calls.push(["register", ...args]); return Response.json({ ok: true, eno: "9223372036854775807" }, { status: 201 });
  } });
  return { client, calls, service, fire: s => callback("SIGNED_IN", s) };
}
for (const [label, value] of [
  ["empty name", { ...input, characterName: " " }],
  ["wrong name type", { ...input, characterName: 1 }],
  ["empty password", { ...input, password: "", confirmation: "" }],
  ["wrong password type", { ...input, password: 2 }],
  ["mismatch", { ...input, confirmation: "other" }],
]) test("registration validation: " + label, () => assert.equal(registrationInput(value).ok, false));

test("registration sends only name/password and preserves large string ENo", async () => {
  const f = setup(); const result = await f.service.register(input);
  assert.deepEqual(result, { ok: true, eno: "9223372036854775807" });
  const [, url, options] = f.calls[0];
  assert.equal(url, config.url + "/functions/v1/register-account");
  assert.equal(options.method, "POST");
  assert.deepEqual(JSON.parse(options.body), { characterName: "名前", password: input.password });
  assert.equal(options.headers.apikey, config.publishableKey);
});
test("mismatched confirmation never sends a request", async () => {
  const f = setup(); await f.service.register({ ...input, confirmation: "" }); assert.equal(f.calls.length, 0);
});
for (const code of ["invalid_input", "password_rejected", "game_account_creation_failed", "auth_user_creation_failed",
  "access_creation_failed", "battler_creation_failed", "registration_unavailable"]) {
  test("registration fixed error: " + code, async () => {
    const service = createAuthService({ config, fetchImpl: async () => Response.json({
      ok: false, error: code, message: input.password,
    }, { status: code === "invalid_input" || code === "password_rejected" ? 400 : 502 }) });
    const result = await service.register(input);
    assert.equal(result.ok, false);
    assert.equal(result.message, authMessages[code] ?? authMessages.server);
    assert.ok(!JSON.stringify(result).includes(input.password));
  });
}
for (const mode of ["network", "json", "unexpected", "numeric-eno"]) {
  test("ambiguous registration result is not retried: " + mode, async () => {
    let count = 0;
    const service = createAuthService({ config, fetchImpl: async () => {
      count++;
      if (mode === "network") throw new Error(input.password);
      if (mode === "json") return new Response("{", { status: 201 });
      return Response.json(mode === "numeric-eno" ? { ok: true, eno: 123 } : {}, { status: 201 });
    } });
    const result = await service.register(input);
    assert.equal(result.message, authMessages.unknown); assert.equal(count, 1);
  });
}
test("login reuses helper; password stays unchanged", async () => {
  const f = setup(); const result = await f.service.login("000123", input.password);
  assert.equal(result.ok, true);
  assert.deepEqual(f.calls[0], ["login", { email: internalEmailForEno("123"), password: input.password }]);
});
for (const eno of ["", "-1", "1e3", "0", "abc", "9223372036854775808", 123]) {
  test("invalid ENo never calls Auth: " + eno, async () => {
    const f = setup(); assert.equal((await f.service.login(eno, "p")).message, authMessages.login);
    assert.equal(f.calls.length, 0);
  });
}
test("Auth errors and thrown errors use identical login message", async () => {
  for (const fail of [async () => ({ error: { message: input.password } }), async () => { throw new Error(input.password); }]) {
    const f = setup(); f.client.auth.signInWithPassword = fail;
    assert.deepEqual(await f.service.login("123", "p"), { ok: false, message: authMessages.login });
  }
});
test("access lookup uses Auth ID predicate and joined game account ENo cast", async () => {
  const f = setup(); assert.deepEqual(await f.service.accounts(session), [{ eno: "123", name: null }]);
  assert.deepEqual(f.calls[0], ["query", "game_account_access", "game_account_id,game_accounts!inner(eno::text,battlers(presentation))", "auth_user_id", "auth-uuid"]);
});
for (const enos of [[], ["123"], ["9223372036854775807", "2"]]) {
  test("restored access count: " + enos.length, async () => {
    const f = setup({ rows: enos.map(eno => ({ game_accounts: { eno } })) }); let state;
    const controller = createAuthController(f.service, s => { state = s; });
    await controller.start();
    assert.equal(state.signedIn, true); assert.equal(state.enos.length, enos.length);
    if (!enos.length) assert.match(state.sessionMessage, /ありません/);
    if (enos.length > 1) { assert.match(state.sessionMessage, /今後実装/); assert.deepEqual(state.enos, ["2", "9223372036854775807"]); }
    assert.equal(f.calls.filter(c => c[0] === "register").length, 0);
    controller.stop();
  });
}
test("logout clears current ENo; failure preserves logged-in display", async () => {
  const f = setup(); let state;
  const controller = createAuthController(f.service, s => { state = s; });
  await controller.start();
  f.client.auth.signOut = async () => ({ error: {} });
  await controller.logout(); assert.equal(state.signedIn, true); assert.match(state.message, /できません/);
  f.client.auth.signOut = async () => ({});
  await controller.logout(); assert.equal(state.signedIn, false); assert.deepEqual(state.enos, []);
  controller.stop();
});
test("busy guard rejects duplicate submissions and state never retains input secrets", async () => {
  let finish, count = 0, state;
  const f = setup();
  f.service.register = () => { count++; return new Promise(resolve => { finish = resolve; }); };
  const controller = createAuthController(f.service, s => { state = s; });
  await controller.start();
  const pending = controller.register(input);
  await controller.register(input);
  assert.equal(count, 1); assert.equal(state.busy, "register");
  finish({ ok: true, eno: "123" }); await pending;
  assert.equal(state.registeredEno, "123"); assert.ok(!JSON.stringify(state).includes(input.password));
  controller.stop();
});
test("late account lookup cannot restore an ENo after signout", async () => {
  const f = setup(); let state, resolve;
  const controller = createAuthController(f.service, s => { state = s; });
  await controller.start();
  f.service.accounts = () => new Promise(r => { resolve = r; });
  f.fire(session); await new Promise(r => setTimeout(r, 10));
  f.fire(null); await new Promise(r => setTimeout(r, 10));
  resolve([{ eno: "999", name: "late" }]); await new Promise(r => setTimeout(r, 0));
  assert.equal(state.signedIn, false); assert.deepEqual(state.enos, []);
  controller.stop();
});
test("HTML/password handling and browser dependency boundary", async () => {
  const root = new URL("../", import.meta.url);
  const html = authMarkup;
  const page = await readFile(new URL("js/authView.js", root), "utf8");
  const service = await readFile(new URL("js/authService.js", root), "utf8");
  const controller = await readFile(new URL("js/authController.js", root), "utf8");
  for (const source of [page, service, controller]) {
    assert.doesNotMatch(source, /console\.|localStorage|sessionStorage|admin-client|auth\.admin/);
  }
  assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /autocomplete="username"/);
  assert.doesNotMatch(html, /name="password"/);
  assert.match(service, /_shared\/internal-email\.mjs/);
  assert.match(page, /el\.value = ""/);
});
