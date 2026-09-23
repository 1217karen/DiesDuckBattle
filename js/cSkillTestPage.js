// C仕様確認用・開発ページ。保存機能/raw effect入力なし。
import { createCSkillCatalog, getCEffectOptions } from "./cSkillCatalog.js";
import { createCSkillRules } from "./cSkillRules.js";
import { compileCSkill } from "./cSkillCompiler.js";
import { createCDevCatalog, createCDevRules } from "./cSkillDevFixtures.js";
import { C_TEST_FIELDS, runCSkillTestBattle } from "./cSkillTestHarness.js";

const $ = id => document.getElementById(id);
const json = value => JSON.stringify(value, null, 2);
const el = (tag, text) => { const n = document.createElement(tag); if (text != null) n.textContent = text; return n; };
const categoryLabels = { damage: "固定ダメージ", healing: "固定heal", percentageDamage: "現在HP割合ダメージ",
  statusGrant: "状態付与", statusClear: "状態全解除", timedHit: "期限付き通常命中status", turnBuff: "turns AT/DF", statusDamage: "debuff総stackダメージ", turnStepDamage: "経過turnダメージ", revive: "特殊C復活" };
const axisLabels = { baseAmount: "基礎ダメージ", everyTurns: "何turnごと", stepAmount: "増加ダメージ", multiplier: "stack倍率", amount: "効果量", duration: "期間（turns）", status: "status", scope: "解除範囲", amountPct: "現在HP割合", maxHpPct: "復活HP割合" };
const reasons = { OPTION_UNSELECTED: "未選択optionがあります", PRICE_UNRESOLVED: "catalog価格が未解決です",
  MODE_UNAVAILABLE: "このmodeでは選べない効果です", EFFECT_COUNT: "効果数が許可範囲外です" };
const important = new Set(["conditionalBranch", "chanceRoll", "randomPick", "cSkillActivated", "fixedDamage", "heal", "revived", "reviveRoll", "statusChange", "buffApplied", "buffTick", "buffExpired",
  "timedRuleApplied", "timedRuleTriggered", "timedRuleTick", "timedRuleExpired", "normalDamage", "battleEnd", "roll", "attackMissed", "attackAvoided"]);
let selection = { mode: "normal", structure: { kind: "flat", effects: [{ effectId: "damage-enemy", options: {} }] } };
let catalog, rules, compilation, lastRun = null;

function select(options, current, label, onChange) {
  const input = el("select"); input.setAttribute("aria-label", label);
  for (const item of options) { const o = el("option", item.label); o.value = item.id; o.disabled = !!item.disabled; input.append(o); }
  input.value = current ?? "";
  input.addEventListener("change", () => onChange(input.value));
  return input;
}
function labeled(label, input) { const n = el("label", label); n.append(input); return n; }
function stale() { if (lastRun) $("battle-message").textContent = "設定を変更しました。下の結果は前回実行時のものです。再実行してください。"; }
function normalizeOptions(chosen) {
  const effect = catalog.effects.find(e => e.id === chosen.effectId);
  chosen.options = Object.fromEntries(Object.entries(effect.optionAxes).flatMap(([axis, setId]) => {
    const options = catalog.optionSets[setId];
    const picked = options.find(o => o.id === chosen.options?.[axis]) ?? options[0];
    return picked ? [[axis, picked.id]] : [];
  }));
}
function branches() {
  const s = selection.structure;
  if (s.kind === "flat") return [["分岐なし", s]];
  if (s.kind === "random") return s.branches.map((b, i) => ["枝 " + (i + 1) + "（等確率）", b]);
  const threshold = catalog.optionSets.hpThreshold.find(o => o.id === s.thresholdOptionId);
  const label = threshold ? threshold.value * 100 + "%" : "threshold未選択";
  return [["自分HP " + label + "以上", s.branches.met], ["自分HP " + label + "未満", s.branches.unmet]];
}
function leafCount() { return branches().reduce((sum, [, b]) => sum + b.effects.length, 0); }
function newEffect() { const e = { effectId: "damage-enemy", options: {} }; normalizeOptions(e); return e; }
function renderEffect(chosen, label) {
  const available = getCEffectOptions(selection.mode, catalog);
  const categories = [...new Set(available.map(e => e.category))];
  const definition = available.find(e => e.id === chosen.effectId);
  const row = el("fieldset"); row.className = "effect-row"; row.append(el("legend", label));
  const changeEffect = id => {
    chosen.effectId = id; chosen.options = {}; delete chosen.chanceOptionId;
    normalizeOptions(chosen); update();
  };
  row.append(labeled("カテゴリ", select(categories.map(id => ({ id, label: categoryLabels[id] ?? id })), definition.category, label + " カテゴリ",
    category => changeEffect(available.find(e => e.category === category).id))));
  row.append(labeled("効果", select(available.filter(e => e.category === definition.category).map(e => ({
    id: e.id, label: e.label + " (" + e.polarity + ")" + (e.selectable ? "" : " — 特殊C専用"), disabled: !e.selectable,
  })), chosen.effectId, label + " 内容", changeEffect)));
  row.append(el("p", definition.polarity === "benefit" ? "benefit" : "drawback：成功率100%固定"));
  if (!definition.selectable) row.append(el("p", definition.reason.message));
  for (const [axis, options] of Object.entries(definition.options)) {
    const choices = [{ id: "", label: options.length ? "選択してください" : "候補・価格未確定" },
      ...options.map(o => ({ id: o.id, label: o.label + " / ΔAP " + (o.apDelta ?? "未確定") }))];
    const input = select(choices, chosen.options[axis], label + " " + axis, id => {
      if (id) chosen.options[axis] = id; else delete chosen.options[axis]; update();
    });
    input.disabled = !options.length; row.append(labeled(axisLabels[axis] ?? axis, input));
  }
  if (definition.polarity === "benefit") {
    row.append(labeled("成功率", select(catalog.chanceOptions, chosen.chanceOptionId ?? "100", label + " 成功率", id => {
      if (id === "100") { delete chosen.chanceOptionId; } else chosen.chanceOptionId = id;
      update();
    })));
    if (chosen.chanceOptionId && chosen.chanceOptionId !== "100") {
      row.append(el("p", ["fixedDamage", "heal"].includes(definition.semantics.type)
        ? "失敗時：主効果の20%（整数の効果量は切り捨て・最低1保証なし）" : "失敗時：効果なし"));
    }
  }
  return row;
}
function renderRows() {
  $("effects").replaceChildren();
  for (const [name, branch] of branches()) {
    const panel = el("section"); panel.append(el("h3", name));
    branch.effects.forEach((chosen, index) => {
      const row = renderEffect(chosen, name + " 効果" + (index + 1));
      const remove = el("button", "削除"); remove.type = "button";
      remove.addEventListener("click", () => { branch.effects.splice(index, 1); update(); }); row.append(remove); panel.append(row);
    });
    const add = el("button", name + "：＋効果を追加"); add.type = "button"; add.disabled = leafCount() >= rules.maxEffects;
    add.addEventListener("click", () => { branch.effects.push(newEffect()); update(); }); panel.append(add);
    $("effects").append(panel);
  }
  const kind = selection.structure.kind;
  $("branch-kind-label").hidden = kind === "flat";
  $("branch-count-label").hidden = kind !== "random";
  $("threshold-control").replaceChildren();
  if (kind === "hpCondition") $("threshold-control").append(labeled("自分HP割合 threshold", select(
    [{ id: "", label: "threshold未選択 / production未確定" }, ...catalog.optionSets.hpThreshold],
    selection.structure.thresholdOptionId, "HP threshold", id => {
      if (id) selection.structure.thresholdOptionId = id; else delete selection.structure.thresholdOptionId; update();
    })));
}
function changeStructure() {
  const kind = $("branching").value === "flat" ? "flat" : $("branch-kind").value;
  selection.structure = kind === "flat" ? { kind, effects: [newEffect()] }
    : kind === "random" ? { kind, branches: Array.from({ length: Number($("branch-count").value) }, () => ({ effects: [newEffect()] })) }
    : { kind, branches: { met: { effects: [newEffect()] }, unmet: { effects: [newEffect()] } } };
  update();
}
function update() {
  stale();
  rules = $("fixture").checked
    ? { ...createCDevRules(), repeatReviveChance: Number($("repeat-chance").value) }
    : createCSkillRules(); // 仮policyと再復活率はfixture ON時だけ。DTO外。
  try {
    compilation = compileCSkill(selection, { catalog, rules });
    renderRows();
    $("resources").replaceChildren();
    for (const key of ["mode", "effectCount", "benefitCount", "drawbackCount", "baseAP", "slotCost", "optionDelta", "rawAP", "requiredAP", "complete"]) {
      $("resources").append(el("dt", key), el("dd", compilation.resources[key] ?? "未確定"));
    }
    $("issues").replaceChildren();
    for (const issue of [...compilation.errors, ...compilation.unresolved]) $("issues").append(el("li", `${reasons[issue.code] ?? issue.code} — ${issue.path} (${issue.code})`));
    if (!$("issues").children.length) $("issues").append(el("li", "問題なし"));
    $("selection").textContent = json(selection); $("compiled").textContent = json(compilation.skill);
    $("resource-json").textContent = json(compilation.resources);
    $("battle").disabled = !compilation.ok;
    $("battle-blocker").textContent = compilation.ok ? "compile済みcSkillで戦闘できます。" : "compile不能：上のerrors / unresolvedを確認してください。本番catalogでは未確定が正常です。";
  } catch (error) {
    compilation = null; $("battle").disabled = true; $("battle-blocker").textContent = `設定エラー：${error.message}`;
  }
}
function switchCatalog() {
  catalog = $("fixture").checked ? createCDevCatalog() : createCSkillCatalog();
  for (const [, branch] of branches()) for (const chosen of branch.effects) {
    normalizeOptions(chosen);
    if (!catalog.chanceOptions.some(o => o.id === chosen.chanceOptionId)) { delete chosen.chanceOptionId; }
  }
  if (!catalog.optionSets.hpThreshold.some(o => o.id === selection.structure.thresholdOptionId)) delete selection.structure.thresholdOptionId;
  $("repeat-chance").disabled = !$("fixture").checked;
  $("catalog-note").textContent = $("fixture").checked
    ? "開発fixture ON：全leaf合算、option・分岐価格・chance割引額は仮の0。ゲーム仕様ではありません。"
    : "本番catalog：数値option・価格は未確定です。開発fixtureをONにするとcompile・戦闘確認できます。";
  update();
}
function renderEvents() {
  $("events").replaceChildren();
  for (const event of lastRun?.battle.events ?? []) {
    if ($("important-only").checked && !important.has(event.type)) continue;
    const row = el("tr"); if (important.has(event.type)) row.className = "highlight";
    const detail = Object.fromEntries(Object.entries(event).filter(([key]) => !["id", "turn", "phase", "actor", "type", "state", "attack", "originSkill", "groupId", "meta"].includes(key)));
    for (const value of [event.turn, event.phase, event.actor, event.type, json(detail)]) row.append(el("td", value));
    $("events").append(row);
  }
}

for (const field of C_TEST_FIELDS) {
  const input = el("input"); input.type = "number"; input.id = field.key; input.min = field.min; input.max = field.max; input.step = "1"; input.value = field.value; input.required = true;
  input.addEventListener("input", stale); $("settings").append(labeled(field.label, input));
}
document.querySelectorAll('input[name="mode"]').forEach(radio => radio.addEventListener("change", () => { selection.mode = radio.value; update(); }));
$("fixture").addEventListener("change", switchCatalog);
$("repeat-chance").addEventListener("change", update);
$("force-death").addEventListener("change", stale);
$("important-only").addEventListener("change", renderEvents);
for (const id of ["branching", "branch-kind", "branch-count"]) $(id).addEventListener("change", changeStructure);
$("battle-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!compilation?.ok) return;
  try {
    const settings = Object.fromEntries(C_TEST_FIELDS.map(f => [f.key, $(f.key).valueAsNumber])); settings.forceDeath = $("force-death").checked;
    const result = runCSkillTestBattle(selection, { catalog, rules, settings }); // 実行時にもcompileを通す。
    if (!result.battle) throw new Error("compileできません。");
    lastRun = result;
    $("battle-message").textContent = `実行完了：${result.battle.result} / ${result.battle.events.length} events（実行時の設定）`;
    $("final-state").textContent = json({ result: result.battle.result, AT: 3, DF: 3, SP: 1, maxHP: 1000,
      finalSnapshot: result.finalState });
    $("battle-json").textContent = json({ selection: structuredClone(selection), settings, ...result }); renderEvents();
  } catch (error) { $("battle-message").textContent = `戦闘テストエラー：${error.message}`; }
});
switchCatalog(); $("startup").textContent = "読み込み完了。";
