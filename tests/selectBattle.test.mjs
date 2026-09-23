import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { listOpponents, getOpponent } from "../js/opponentSource.js";
import { inspectBattleLoadout, compileBattleLoadout } from "../js/battleLoadoutCompiler.js";
import { createSelectState, selectOwnDuck, selectOpponent, selectOpponentDuck, opponentDuckChoices, battleStartStatus } from "../js/selectState.js";
import { startSelectedBattle } from "../js/selectBattle.js";
import { runBattle } from "../js/battleEngine.js";
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
