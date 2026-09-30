import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createEmptyPlayerBuild, createEmptyDuck } from "../js/playerBuildModel.js";
import { createEmptyPlayerPresentation } from "../js/playerPresentationModel.js";
import { encodeOnlinePlayer, decodeOnlinePlayer } from "../js/onlinePlayerDto.js";
let PGlite;
if (process.env.PGLITE_MODULE) ({ PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE)));
const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const d1 = "33333333-3333-4333-8333-333333333333", d2 = "44444444-4444-4444-8444-444444444444";
const empty = () => ({ build: createEmptyPlayerBuild(), presentation: createEmptyPlayerPresentation(),
  publicSettings: { schemaVersion: 1, publicDuckId: null }, battlerName: "オンライン初期名" });

test("local Postgres migration/RLS/RPC integration (no network)", { skip: !PGlite && "Set PGLITE_MODULE to the installed @electric-sql/pglite dist/index.js" }, async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
      grant usage on schema public, auth to authenticated, anon, service_role;
      grant execute on function auth.uid() to authenticated, anon, service_role;`);
    for (const name of ["20260929132128_initial_online_schema.sql", "20260930165424_online_player_storage.sql"])
      await db.exec(await readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8"));
    await db.exec(`insert into auth.users values ('${userA}'),('${userB}');
      insert into public.game_accounts(id) values ('${a}'),('${b}');
      insert into public.game_account_access(auth_user_id,game_account_id) values ('${userA}','${a}'),('${userB}','${b}');
      insert into public.battlers(game_account_id,presentation) values ('${a}','{"name":"A"}'),('${b}','{"name":"B"}');
      set role authenticated; select set_config('request.jwt.claim.sub','${userA}',false);`);
    const load = async id => (await db.query("select public.load_online_player($1) as data", [id])).rows[0].data;
    const save = async (id, revision, payload) => (await db.query("select public.save_online_player($1,$2,$3::jsonb) as data", [id, revision, JSON.stringify(payload)])).rows[0].data;
    await t.test("initial accounts are independent and other full draft is inaccessible", async () => {
      const initial = await load(a); assert.equal(decodeOnlinePlayer(initial).battlerName, "A");
      assert.equal(await load(b), null);
      await assert.rejects(save(b, "0", encodeOnlinePlayer(empty())), { code: "42501" });
    });
    let state = empty(); state.build.ducks.push(createEmptyDuck({ idFactory: () => d1 }), createEmptyDuck({ idFactory: () => d2 }));
    state.build.ducks[0].name = "同名"; state.build.ducks[1].name = "同名";
    state.presentation.ducks[d1] = { iconUrl: "https://example.invalid/icon.png" };
    state.presentation.ducks["orphan-local-id"] = { iconUrl: "https://example.invalid/orphan.png" };
    state.publicSettings.publicDuckId = d1;
    await t.test("incomplete builds, order, icons and UUIDs roundtrip atomically", async () => {
      const before = await load(a); const result = await save(a, before.revision, encodeOnlinePlayer(state));
      const after = await load(a); assert.equal(after.revision, result.revision);
      assert.deepEqual(decodeOnlinePlayer(after), state); assert.notEqual(before.revision, after.revision);
      assert.equal((await db.query("select count(*)::int n from public.ducks where game_account_id=$1", [b])).rows[0].n, 0);
    });
    await t.test("stale tab is rejected and cannot silently overwrite", async () => {
      const before = await load(a); await save(a, before.revision, encodeOnlinePlayer(state));
      const after = await load(a);
      await assert.rejects(save(a, before.revision, encodeOnlinePlayer(empty())), { code: "40001" });
      assert.deepEqual(await load(a), after);
    });
    await t.test("direct table edits also invalidate a loaded revision", async () => {
      const before = await load(a);
      await db.query("update public.ducks set sort_order=10 where id=$1", [d2]);
      await assert.rejects(save(a, before.revision, encodeOnlinePlayer(state)), { code: "40001" });
    });
    await t.test("late failure rolls back cleared public Duck, Battler and all earlier writes", async () => {
      await db.exec(`reset role; create function public.test_fail_duck() returns trigger language plpgsql as $$begin
        if new.id = '${d2}' then raise exception 'injected failure' using errcode='23514'; end if; return new; end$$;
        create trigger z_test_fail before update on public.ducks for each row execute function public.test_fail_duck(); set role authenticated;`);
      const before = await load(a); const draft = encodeOnlinePlayer(state); draft.battler.presentation.name = "should rollback";
      await assert.rejects(save(a, before.revision, draft), { code: "23514" });
      assert.deepEqual(await load(a), before);
      await db.exec("reset role; drop trigger z_test_fail on public.ducks; drop function public.test_fail_duck(); set role authenticated;");
    });
    await t.test("public Duck removal requires explicit unpublish and commits together", async () => {
      const before = await load(a); state = empty();
      await save(a, before.revision, encodeOnlinePlayer(state));
      const after = await load(a); assert.equal(after.publicDuckId, null); assert.deepEqual(after.ducks, []);
    });
    await t.test("foreign UUID collision and public ownership violation cannot alter another account", async () => {
      await db.exec(`reset role; insert into public.ducks(id,game_account_id) values ('${d1}','${b}');
        update public.game_accounts set public_duck_id='${d1}' where id='${b}'; set role authenticated;`);
      const before = await load(a); const draft = empty(); draft.build.ducks.push(createEmptyDuck({ idFactory: () => d1 }));
      await assert.rejects(save(a, before.revision, encodeOnlinePlayer(draft)));
      assert.deepEqual(await load(a), before);
      await assert.rejects(db.query("update public.game_accounts set public_duck_id=$1 where id=$2", [d1,a]), { code:"23503" });
      assert.equal((await db.query("update public.ducks set build='{}' where id=$1 returning id",[d1])).rows.length,0);
    });
    await t.test("anon, revision tampering, and client access grants remain forbidden", async () => {
      await assert.rejects(db.query("update public.game_accounts set save_revision=0 where id=$1", [a]), { code:"42501" });
      await assert.rejects(db.query("insert into public.game_account_access values ($1,$2,now())",[userA,b]), { code:"42501" });
      await db.exec("reset role; set role anon;");
      await assert.rejects(load(a), { code:"42501" });
      await assert.rejects(save(a,"0",encodeOnlinePlayer(empty())), { code:"42501" });
    });
  } finally { await db.close(); }
});
