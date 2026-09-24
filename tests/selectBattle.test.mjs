import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { listOpponents, getOpponent } from "../js/opponentSource.js";
import { inspectBattleLoadout, compileBattleLoadout } from "../js/battleLoadoutCompiler.js";
import { createSelectState, selectOwnDuck, selectOpponent, selectOpponentDuck, opponentDuckChoices, battleStartStatus } from "../js/selectState.js";
import { startSelectedBattle } from "../js/selectBattle.js";
import { runBattle } from "../js/battleEngine.js";
import vm from "node:vm";
import * as selectState from "../js/selectState.js";
import { buildBattlePresentationSnapshot } from "../js/battlePresentationSnapshot.js";
import { createPlayerPresentationStorage } from "../js/playerPresentationStorage.js";
import { createBattleResultStorage } from "../js/battleResultStorage.js";
async function setup() {
  const list = await listOpponents(), self = await getOpponent(list[0].id), opponent = await getOpponent(list[1].id);
  self.build.ducks[0].id = "self-duck";
  return { state: createSelectState({ok:true,status:"loaded",build:self.build}), opponent };
}
test("async source has exactly two detached production-ready selection builds", async () => {
  const list = await listOpponents(); assert.equal(list.length,2);
  for(const entry of list) {
    const o=await getOpponent(entry.id); assert.ok(o.name.includes("開発用"));
    for(const d of o.build.ducks) assert.equal(inspectBattleLoadout(o.build,d.id).ready,true);
    o.build.ducks[0].stats.AT=999;
    assert.notEqual((await getOpponent(entry.id)).build.ducks[0].stats.AT,999);
  }
  assert.equal(await getOpponent("missing"),null);
});
test("VS gates each choice; opponent changes reset only opponent Duck", async () => {
  let {state,opponent}=await setup();
  assert.equal(battleStartStatus(state).canStart,false);
  state=selectOpponent(state,opponent); state=selectOpponentDuck(state,opponent.build.ducks[0].id);
  assert.equal(battleStartStatus(state).canStart,false);
  state=selectOwnDuck(state,"self-duck"); assert.equal(battleStartStatus(state).canStart,true);
  state=selectOpponent(state,null); assert.equal(battleStartStatus(state).canStart,false);
  state=selectOpponent(state,opponent); assert.equal(state.opponentDuckId,null); assert.equal(battleStartStatus(state).canStart,false);
  state=selectOpponentDuck(state,opponent.build.ducks[0].id);
  const next=await getOpponent((await listOpponents())[0].id); state=selectOpponent(state,next);
  assert.equal(state.opponentDuckId,null); assert.equal(state.selectedDuckId,"self-duck");
});
test("unready opponent Ducks stay listed but cannot be selected",async()=>{
  let {state,opponent}=await setup();
  const draft=structuredClone(opponent.build.ducks[0]); draft.id="draft"; draft.aSelection=null;
  const bad=structuredClone(draft); bad.id="bad"; bad.stats.AT=999;
  opponent.build.ducks.push(draft,bad); state=selectOpponent(state,opponent);
  assert.deepEqual(opponentDuckChoices(state).map(d=>d.status),["選択可能","未完成","使用不可"]);
  for(const id of ["draft","bad","missing"]) assert.equal(selectOpponentDuck(state,id),state);
});
test("both compiled outputs finish engine battle and UI runner returns same summary",async()=>{
  let {state,opponent}=await setup(); state=selectOwnDuck(state,"self-duck");
  state=selectOpponentDuck(selectOpponent(state,opponent),opponent.build.ducks[0].id);
  const before=JSON.stringify(state);
  const p1=compileBattleLoadout(state.build,{duckId:state.selectedDuckId,battlerId:state.self.id,battlerName:state.self.name});
  const p2=compileBattleLoadout(opponent.build,{duckId:state.opponentDuckId,battlerId:opponent.id,battlerName:opponent.name});
  assert.equal(p1.ok && p2.ok,true);
  const battle=runBattle({p1:{battlerId:p1.battler.id,duckId:p1.duck.id},p2:{battlerId:p2.battler.id,duckId:p2.duck.id},data:{BATTLERS:[p1.battler,p2.battler],DUCKS:[p1.duck,p2.duck]},rng:()=>.5});
  assert.equal(battle.events.at(-1).type,"battleEnd");
  const result=startSelectedBattle(state,{rng:()=>.5}); assert.equal(result.ok,true); assert.equal(result.result,battle.result);
  assert.ok(["P1 WIN","P2 WIN","DRAW"].includes(result.label)); assert.ok(result.turns>0);
  assert.equal(JSON.stringify(state),before);
  state.opponent.build.battler.dSelection=null; assert.equal(startSelectedBattle(state).ok,false);
});
test("UI consumes source contract, not fixture data; runner invokes compiler for both sides",async()=>{
  const ui=await readFile(new URL("../js/select.js",import.meta.url),"utf8");
  assert.match(ui,/listOpponents\(\)/); assert.match(ui,/await getOpponent\(id\)/);
  assert.doesNotMatch(ui,/dev-opponent|damageAmount|amount-5|bSelection\s*:/);
  const runner=await readFile(new URL("../js/selectBattle.js",import.meta.url),"utf8");
  assert.equal((runner.match(/= compileBattleLoadout\(/g)||[]).length,2);
});

test("VS reads current P1 presentation before battle and saves both snapshots without changing events", async () => {
  let { state, opponent } = await setup();
  state = selectOwnDuck(state, "self-duck");
  state = selectOpponentDuck(selectOpponent(state, opponent), opponent.build.ducks[0].id);
  const values = new Map();
  const backend = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const presentationStorage = createPlayerPresentationStorage(backend);
  const resultStorage = createBattleResultStorage(backend);
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
      handlers: {}, classList: { toggle() {} }, setAttribute() {},
      addEventListener(type, handler) { this.handlers[type] = handler; },
    });
    return elements.get(id);
  } };
  let latestBattle, navigation, battleNumber = 0;
  const ui = await readFile(new URL("../js/select.js", import.meta.url), "utf8");
  // Execute the real click handler with storage and engine; only browser elements are stubbed.
  vm.runInNewContext(ui.replace(/^import .*;\r?\n/gm, ""), {
    ...selectState, document, listOpponents, getOpponent,
    createSelectState: () => state,
    createPlayerBuildStorage: () => ({ load: () => ({}) }),
    createPlayerPresentationStorage: () => presentationStorage,
    createBattleResultStorage: () => resultStorage,
    createBattleId: () => `vs-${++battleNumber}`,
    buildBattlePresentationSnapshot,
    startSelectedBattle(current) {
      // Even an edit during execution must not replace the start-time snapshot.
      presentationStorage.save({ battler: { defaultIconUrl: "later.png" } });
      latestBattle = startSelectedBattle(current, { rng: () => .5 });
      return latestBattle;
    },
    location: { assign: url => { navigation = url; } },
  });
  const current = {
    battler: { defaultIconUrl: "current.png", iconSlots: ["", "", "third.png"],
      quotes: { battleStart: { text: "開始", iconSlot: 3 } } },
    ducks: { "self-duck": { iconUrl: "selected.png" } },
  };
  // Saved after the select screen loads, so a cached presentation would be wrong.
  presentationStorage.save(current);
  document.getElementById("vsButton").handlers.click();
  assert.equal(navigation, "result.html?battleId=vs-1");
  const loaded = resultStorage.load("vs-1");
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.record.p1.presentation, buildBattlePresentationSnapshot(current, "self-duck"));
  assert.deepEqual(loaded.record.p2.presentation, buildBattlePresentationSnapshot());
  assert.deepEqual(loaded.record.events, latestBattle.events);
  values.clear();
  document.getElementById("vsButton").handlers.click();
  assert.equal(navigation, "result.html?battleId=vs-2");
  assert.deepEqual(resultStorage.load("vs-2").record.p1.presentation, buildBattlePresentationSnapshot());
});
