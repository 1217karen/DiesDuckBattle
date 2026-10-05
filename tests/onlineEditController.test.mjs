import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createOnlineEditController } from "../js/onlineEditController.js";
import { onlineFailure } from "../js/onlinePlayerStorage.js";
import { createEmptyPlayerBuild, createEmptyDuck } from "../js/playerBuildModel.js";
import { createEmptyPlayerPresentation } from "../js/playerPresentationModel.js";
import { createSettingState, changeSetting } from "../js/settingState.js";
import { inspectBuildForSave } from "../js/buildSaveInspection.js";
const clone = structuredClone;
function fixture() {
  let user = "auth-2", eno = "2", error, accept = true, pending;
  const calls = [], notifications = [], questions = [];
  const rows = new Map(["2", "3"].map(eno => [eno, { ok: true, account: { id: `account-${eno}`, eno }, authUserId: `auth-${eno}`, revision: "0",
    data: { build: createEmptyPlayerBuild(), presentation: createEmptyPlayerPresentation(), publicSettings: { schemaVersion: 1, publicDuckId: null }, battlerName: `DB名${eno}` } }]));
  const storage = {
    async resolveAccount() { return error ? onlineFailure(error) : { ...clone(rows.get(eno)), authUserId: user }; },
    async load() { calls.push("load"); return pending ? pending.promise : error ? onlineFailure(error) : clone(rows.get(eno)); },
    async save(base, data) {
      calls.push("save"); if (pending) return pending.promise;
      if (error) return onlineFailure(error);
      if (base.authUserId !== user || base.account.eno !== eno) return onlineFailure("session-changed");
      if (base.revision !== rows.get(eno).revision) return onlineFailure("conflict");
      const result = { ...base, data: clone(data), revision: String(BigInt(base.revision) + 1n) }; rows.set(eno, result); return clone(result);
    },
  };
  const make = (sections = ["build", "publicSettings"]) => createOnlineEditController({ storage, sections,
    confirm: question => { questions.push(question); return accept; }, notify: event => notifications.push(event) });
  return { make, rows, calls, notifications, questions, error: value => { error = value; }, accept: value => { accept = value; },
    switch: value => { eno = value; user = `auth-${eno}`; },
    defer() { let resolve; const promise = new Promise(r => { resolve = r; }); pending = { promise, resolve }; return value => { pending = null; resolve(value); }; },
  };
}
test("ENo independent initial load/save and no client-side name fallback", async () => {
  const f = fixture(), c = f.make(); await c.load(); assert.equal(c.snapshot().draft.battlerName, "DB名2");
  const build = clone(c.snapshot().draft.build); build.ducks.push(createEmptyDuck()); c.edit({ build }); await c.save();
  assert.equal(c.snapshot().base.revision, "1"); assert.equal(c.snapshot().dirty, false);
  assert.deepEqual(f.notifications, [{ kind: "success", message: "保存しました。" }]);
  f.switch("3"); c.sessionChanged("auth-3"); assert.equal(c.snapshot().draft, null); await c.load();
  assert.equal(c.snapshot().draft.build.ducks.length, 0); assert.equal(c.snapshot().draft.battlerName, "DB名3");
});
test("incomplete setting draft and public Duck deletion use a single full save", async () => {
  const f = fixture(), c = f.make(); await c.load();
  let s = createSettingState({ ok: true, status: "loaded", build: c.snapshot().draft.build });
  s = changeSetting(s, { type: "add" }); s = changeSetting(s, { type: "set-public", id: s.selectedDuckId });
  assert.equal(inspectBuildForSave(s.build).canSave, true); assert.equal(inspectBuildForSave(s.build).complete, false);
  c.edit({ build: s.build, publicSettings: s.publicSettings }); await c.save();
  s = changeSetting(s, { type: "delete" }); c.edit({ build: s.build, publicSettings: s.publicSettings }); await c.save(); await c.load();
  assert.equal(c.snapshot().draft.publicSettings.publicDuckId, null); assert.equal(c.snapshot().draft.build.ducks.length, 0);
  assert.equal(f.calls.filter(x => x === "save").length, 2);
});
test("separate tabs conflict, retain draft, compare, explicitly rebase own section and preserve latest other page", async () => {
  const f = fixture(), setting = f.make(), character = f.make(["presentation"]); await setting.load(); await character.load();
  const presentation = character.snapshot().draft.presentation;
  presentation.battler.standingImageUrl = "https://example.invalid/a.png";
  presentation.battler.iconSlots[9] = "https://example.invalid/icon.png";
  presentation.battler.quotes.battleStart = { lines: [{ text: "セリフ", iconSlot: 10 , opponentEno:null}] };
  presentation.ducks.orphan = { iconUrl: "https://example.invalid/orphan.png" };
  character.edit({ presentation }); await character.save();
  const build = setting.snapshot().draft.build; build.ducks.push(createEmptyDuck()); setting.edit({ build });
  assert.equal((await setting.save()).status, "conflict"); assert.equal(setting.snapshot().draft.build.ducks.length, 1);
  assert.equal((await setting.save()).status, "blocked"); await setting.compare();
  assert.deepEqual(setting.snapshot().latest.data.presentation, presentation);
  f.accept(false); assert.equal(await setting.adoptLatest(true), false); f.accept(true);
  assert.equal(await setting.adoptLatest(true), true); assert.equal(setting.snapshot().dirty, true);
  assert.deepEqual(setting.snapshot().draft.presentation, presentation); await setting.save();
  await character.load(); assert.equal(character.snapshot().draft.build.ducks.length, 1);
  assert.deepEqual(character.snapshot().draft.presentation, presentation); assert.equal(character.snapshot().draft.battlerName, "DB名2");
});
test("character rebase preserves newly added Duck/public choice/build/name", async () => {
  const f = fixture(), s = f.make(), c = f.make(["presentation"]); await s.load(); await c.load();
  const build = s.snapshot().draft.build; const duck = createEmptyDuck(); build.ducks.push(duck);
  s.edit({ build, publicSettings: { schemaVersion: 1, publicDuckId: duck.id } }); await s.save();
  const presentation = c.snapshot().draft.presentation; presentation.battler.quotes.skill.A.lines[0].text = "保持";
  presentation.battler.quotes.skill.A.lines.push({text:'追加も保持',iconSlot:2,opponentEno:'15'}); c.edit({ presentation });
  assert.equal((await c.save()).status, "conflict"); await c.compare(); await c.adoptLatest(true); await c.save();
  assert.deepEqual(f.rows.get("2").data.build, build); assert.equal(f.rows.get("2").data.publicSettings.publicDuckId, duck.id);
});
for (const status of ["save-unknown", "conflict", "load-failed", "invalid-data"]) test(`failure ${status} never retries or clears dirty; failed compare keeps draft`, async () => {
  const f = fixture(), c = f.make(); await c.load(); const build = c.snapshot().draft.build; build.ducks.push(createEmptyDuck()); c.edit({ build }); f.error(status);
  await c.save(); assert.equal(c.snapshot().dirty, true); assert.equal(c.snapshot().canSave, false);
  await c.save(); assert.equal(f.calls.filter(x => x === "save").length, 1); await c.compare();
  assert.deepEqual(c.snapshot().draft.build, build); assert.equal(f.notifications.length, 0);
});
for (const status of ["not-signed-in", "no-access", "selection-required", "unsupported-data", "load-failed"]) test(`initial ${status} cannot edit/save empty defaults`, async () => {
  const f = fixture(); f.error(status); const c = f.make(); await c.load(); assert.equal(c.snapshot().draft, null);
  assert.equal(c.edit({ build: createEmptyPlayerBuild() }), false); assert.equal((await c.save()).status, "blocked");
});
test("reload/discard and logout require confirmation; cancelled operations retain draft", async () => {
  const f = fixture(), c = f.make(); await c.load(); c.edit({ build: c.snapshot().draft.build }); f.accept(false);
  assert.equal((await c.load()).status, "cancelled"); assert.equal(await c.canLeave(), false); assert.equal(c.snapshot().dirty, true);
  f.accept(true); await c.compare(); await c.adoptLatest(false); assert.equal(c.snapshot().dirty, false); assert.equal(await c.canLeave(), true);
});
test("pending save prevents duplicate saves/edits/logout and late response cannot revive previous account", async () => {
  const f = fixture(), c = f.make(); await c.load(); c.edit({ build: c.snapshot().draft.build });
  const old = clone(f.rows.get("2")), finish = f.defer(), save = c.save();
  assert.equal((await c.save()).status, "blocked"); assert.equal(c.edit({ build: old.data.build }), false); assert.equal(await c.canLeave(), false);
  c.sessionChanged("auth-3"); f.switch("3"); finish(old); assert.equal((await save).status, "stale");
  assert.equal(c.snapshot().draft, null); assert.equal(f.notifications.length, 0); await c.load(); assert.equal(c.snapshot().base.account.eno, "3");
});
test("old load response is ignored after sign-out", async () => {
  const f = fixture(), c = f.make(), finish = f.defer(), load = c.load();
  c.sessionChanged(null); finish(f.rows.get("2")); assert.equal((await load).status, "stale"); assert.equal(c.snapshot().draft, null);
});
for (const status of ["no-access", "selection-required", "forbidden"]) test(`access revoked (${status}) hides old account and disallows saves`, async () => {
  const f = fixture(), c = f.make(); await c.load(); c.edit({ build: c.snapshot().draft.build }); f.error(status); await c.checkScope();
  assert.equal(c.snapshot().draft, null); assert.equal(c.snapshot().canSave, false);
});
test("same Auth user with changed account scope invalidates editing", async () => {
  const f = fixture(), c = f.make(); await c.load(); f.switch("3"); await c.checkScope(); assert.equal(c.snapshot().draft, null);
});
test("load failure after editing keeps inputs; snapshots and patches do not leak mutable references", async () => {
  const f = fixture(), c = f.make(); await c.load(); const build = c.snapshot().draft.build; c.edit({ build }); build.ducks.push(createEmptyDuck());
  assert.equal(c.snapshot().draft.build.ducks.length, 0); f.error("load-failed"); await c.load(); assert.equal(c.snapshot().dirty, true);
  assert.equal(c.snapshot().canSave, false); assert.equal(c.edit({ battlerName: "forbidden patch" }), false);
});
test("online editor pages do not import/read/write local storage or server-only modules", async () => {
  for (const file of ["settingPage", "characterPage", "onlineEditor", "onlineEditController"]) {
    const source = await readFile(new URL(`../js/${file}.js`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /localStorage|sessionStorage|player(?:Build|Presentation|PublicSettings)Storage|admin-client|service_role/);
  }
});
test("failed recheck cannot adopt a cached comparison result", async () => {
  const f = fixture(), c = f.make(); await c.load(); await c.compare(); assert.ok(c.snapshot().latest);
  f.error("load-failed"); await c.compare(); assert.equal(c.snapshot().latest, null); assert.equal(await c.adoptLatest(true), false);
});
test("account changes while discard confirmation is open cancel that operation", async () => {
  const f = fixture(); let accept;
  const c = createOnlineEditController({ storage: { load: async () => structuredClone(f.rows.get("2")) }, sections: ["build"],
    confirm: () => new Promise(resolve => { accept = resolve; }) });
  await c.load(); c.edit({ build: c.snapshot().draft.build }); const reload = c.load();
  assert.equal(c.snapshot().busy, "confirm"); c.sessionChanged("auth-3"); accept(true);
  assert.equal((await reload).status, "cancelled"); assert.equal(c.snapshot().draft, null);
});
