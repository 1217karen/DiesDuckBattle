import test from "node:test";
import assert from "node:assert/strict";
import { createBSkillCatalog, getBConditionOptions, getBEffectOptions } from "../js/bSkillCatalog.js";
import { changeBEvent, bEventEditorSelection, bEventEditorDefinition } from "../js/bSkillSentenceEditor.js";
import { bSentence } from "../js/bSkillPresentation.js";
import { compileBSkill } from "../js/bSkillCompiler.js";
import { migrateSelection } from "../js/selectionNormalization.js";
import { createPlayerBuildStorage, PLAYER_BUILD_STORAGE_KEY } from "../js/playerBuildStorage.js";
import { createEmptyPlayerBuild } from "../js/playerBuildModel.js";
import { inspectBuildForSave } from "../js/buildSaveInspection.js";
const catalog = createBSkillCatalog();
const blank = () => ({ type: "event", triggerId: "", conditionId: "", effectId: "", options: {} });
const edit = (s,k,v) => changeBEvent(s,k,v,catalog);

test("左から条件/効果/状態を選べ、完成文と既存v2保存形式を生成", () => {
  let s = edit(blank(), "triggerId", "after-hit");
  assert.equal(s.conditionId, ""); assert.equal(s.effectId, "");
  s = edit(s, "conditionId", "damage-medium"); s = edit(s, "effectId", "enemy-debuff");
  assert.equal(compileBSkill(s).ok, false);
  const pending = bEventEditorSelection(s,catalog);
  assert.equal(pending.effectId, "enemy-debuff"); assert.ok(bEventEditorDefinition(pending,catalog));
  s = edit(s,"statusId","crack"); assert.equal(compileBSkill(s).ok,true);
  assert.deepEqual(s, { type:"event", triggerId:"after-hit", conditionId:"damage-medium", effectId:"grant-status",
    targetId:"enemy", statusId:"crack", options:{activation:"guaranteed"} });
  let chosen = bEventEditorSelection(s,catalog);
  assert.equal(bSentence(bEventEditorDefinition(chosen,catalog),chosen.options.statusId), "攻撃命中後、与えた通常ダメージが7以上なら、相手アヒルに亀裂を2付与する");
  s = edit(s,"statusId","random"); chosen = bEventEditorSelection(s,catalog);
  assert.equal(bSentence(bEventEditorDefinition(chosen,catalog),chosen.options.statusId), "攻撃命中後、与えた通常ダメージが7以上なら、相手アヒルにランダムな状態異常を2付与する");
});

test("前段変更で不正な後段をクリアし、唯一候補の節は固定可能", () => {
  let s = { type:"event",triggerId:"after-hit",conditionId:"damage-high",effectId:"self-heal",options:{} };
  s = edit(s,"conditionId","always"); assert.equal(s.effectId,""); assert.deepEqual(s.options,{});
  s = edit(s,"triggerId","before-attack"); assert.equal(s.conditionId,"");
  s = edit(s,"conditionId","self-has-debuff");
  const chosen = bEventEditorSelection(s,catalog); assert.equal(chosen.effectId,"attack-at-up");
  assert.equal(getBEffectOptions(chosen.triggerId,chosen.conditionId,catalog).length,1);
  assert.equal(compileBSkill(s).ok,true);
  s = edit(s,"triggerId","phase-end"); assert.equal(s.conditionId,""); assert.equal(s.effectId,"");
});

test("全合法statusと全67定義をselection v2から文章型UIへ復元、再保存でも意味不変", () => {
  for (const d of catalog.events) for (const status of d.optionAxes.statusId ? catalog.optionSets[d.optionAxes.statusId] : [null]) {
    const legacy={type:"event",triggerId:d.triggerId,conditionId:d.conditionId,effectId:d.effectId,options:status?{statusId:status.id}:{}};
    const saved=migrateSelection("B",legacy,catalog), snapshot=structuredClone(saved);
    const chosen=bEventEditorSelection(saved,catalog);
    assert.deepEqual(chosen,legacy); assert.equal(bEventEditorDefinition(chosen,catalog).id,d.id);
    assert.deepEqual(compileBSkill(edit(saved,"effectId",d.effectId)).bSkills,compileBSkill(saved).bSkills,d.id);
    assert.deepEqual(saved,snapshot);
    assert.doesNotMatch(bSentence(d,status?.id),/undefined|NaN|\{status\}|総stack/);
  }
  assert.equal(catalog.traits.filter(d=>d.presentation.category==="HP条件").length,22);
  assert.equal(catalog.traits.filter(d=>d.presentation.category==="AP基準補正").length,4);
  assert.equal(catalog.traits.filter(d=>d.presentation.category==="ランダム倍率変更").length,4);
});

test("削除済みv2 BはlocalStorage読込後も保持・validation error・自動置換なし", () => {
  const build=createEmptyPlayerBuild();
  build.battler.bSelection={type:"event",triggerId:"after-hit",conditionId:"always",effectId:"change-next-at",targetId:"enemy",options:{direction:"decrease"}};
  const raw=JSON.stringify(build), storage={ getItem:key=>key===PLAYER_BUILD_STORAGE_KEY?raw:null, setItem:()=>assert.fail("unexpected write") };
  const loaded=createPlayerBuildStorage(storage).load(); assert.equal(loaded.ok,true);
  assert.deepEqual(loaded.build.battler.bSelection,build.battler.bSelection);
  assert.equal(inspectBuildForSave(loaded.build).canSave,false);
  const chosen=bEventEditorSelection(loaded.build.battler.bSelection,catalog);
  assert.equal(chosen.effectId,""); assert.equal(bEventEditorDefinition(chosen,catalog),undefined);
});

test("候補はcatalogの絞り込みのみ、追加したtrusted定義も同じ経路で表示可能", () => {
  const modified=structuredClone(catalog);
  modified.events=modified.events.filter(d=>d.triggerId==="phase-end"&&d.conditionId==="first-action");
  assert.deepEqual(getBConditionOptions("phase-end",modified).map(o=>o.id),["first-action"]);
  const changed=changeBEvent(blank(),"triggerId","phase-end",modified);
  assert.equal(changed.conditionId,"first-action"); assert.equal(changed.effectId,"");
});
