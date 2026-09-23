// 開発専用。合法性・数値はcatalog/compilerへ委譲。保存・raw入力は提供しない。
import { createBSkillCatalog, getBTriggerOptions, getBConditionOptions, getBEffectOptions,
  getBTraitOptions, getBSelectionDefinition } from "./bSkillCatalog.js";
import { compileBSkill, validateBSkillSelection } from "./bSkillCompiler.js";
import { createBDevCatalog } from "./bSkillDevFixtures.js";
import { B_TEST_FIELDS, createBTestSettings, runBSkillTestBattle } from "./bSkillTestHarness.js";
import { STATUS_GROUPS } from "./statusGroups.js";

const $ = id => document.getElementById(id);
const json = value => JSON.stringify(value, null, 2);
const el = (tag, text) => { const n = document.createElement(tag); if (text != null) n.textContent = text; return n; };
const labeled = (text, input) => { const label = el("label", text); label.append(input); return label; };
let catalog = createBSkillCatalog(), selection, compilation, lastRun;
const important = new Set(["skillTriggered", "passiveSkillStateChanged", "passiveModifierChanged", "passiveBonusTotalChanged",
  "valueChanged", "statusChange", "chanceRoll", "heal", "fixedDamage", "normalDamage", "attackChanged", "attackMissed",
  "attackAvoided", "phaseStart", "actionCanceled", "buffApplied", "buffExpired", "battleEnd"]);
function select(items, current, id, onChange) {
  const input = el("select"); input.id = id;
  for (const item of items) { const option = el("option", item.label); option.value = item.id; input.append(option); }
  input.value = current ?? "";
  input.addEventListener("change", () => { onChange(input.value); update(); });
  return input;
}
function setEffect(effectId) {
  selection.effectId = effectId ?? ""; selection.options = {};
  const definition = getBSelectionDefinition(selection, catalog);
  for (const [axis, group] of Object.entries(definition?.optionAxes ?? {})) {
    const option = catalog.optionSets[group][0]; if (option) selection.options[axis] = option.id;
  }
}
function setCondition(conditionId) {
  selection.conditionId = conditionId ?? "";
  setEffect(getBEffectOptions(selection.triggerId, selection.conditionId, catalog)[0]?.effectId);
}
function setTrigger(triggerId) {
  selection.triggerId = triggerId ?? "";
  setCondition(getBConditionOptions(selection.triggerId, catalog)[0]?.id);
}
function resetType(type) {
  selection = type === "trait" ? { type, traitId: getBTraitOptions(catalog)[0]?.id ?? "", options: {} }
    : { type, triggerId: "", conditionId: "", effectId: "", options: {} };
  if (type === "event") setTrigger(getBTriggerOptions(catalog)[0]?.id);
}
function stale() { if (lastRun) $("battle-message").textContent = "設定変更あり。以下は前回実行時の結果です。再実行してください。"; }
function pair(container, label, value) { container.append(el("dt", label), el("dd", value)); }
function renderChoices() {
  const box = $("choices"); box.replaceChildren();
  if (selection.type === "event") {
    box.append(labeled("1. 発動タイミング", select(getBTriggerOptions(catalog), selection.triggerId, "trigger", setTrigger)));
    box.append(labeled("2. 条件", select(getBConditionOptions(selection.triggerId, catalog), selection.conditionId, "condition", setCondition)));
    box.append(labeled("3. 効果", select(getBEffectOptions(selection.triggerId, selection.conditionId, catalog)
      .map(e => ({ id: e.effectId, label: e.effectLabel })), selection.effectId, "effect", setEffect)));
  } else box.append(labeled("特性", select(getBTraitOptions(catalog), selection.traitId, "trait", id => { selection.traitId = id; selection.options = {}; })));
  const definition = getBSelectionDefinition(selection, catalog);
  for (const [axis, group] of Object.entries(definition?.optionAxes ?? {})) box.append(labeled("4. 指定する状態",
    select(catalog.optionSets[group], selection.options[axis], axis, id => { selection.options[axis] = id; })));
  $("summary").replaceChildren(); $("tuning").replaceChildren();
  if (definition) {
    if (selection.type === "event") for (const [label, value] of [["発動", definition.triggerLabel], ["条件", definition.conditionLabel], ["効果", definition.effectLabel]]) pair($("summary"), label, value);
    else pair($("summary"), "特性", definition.label);
    for (const [axis, group] of Object.entries(definition.optionAxes)) pair($("summary"), "指定状態", catalog.optionSets[group].find(o => o.id === selection.options[axis])?.label ?? "不正な選択");
    for (const [key, value] of Object.entries(definition.tuning)) pair($("tuning"), definition.tuningLabels[key], value == null ? "未確定" : value === false ? "上限なし" : String(value));
    if (!Object.keys(definition.tuning).length) pair($("tuning"), "未確定値", "なし（構造上の確定値のみ）");
  }
  $("selection-note").textContent = $("fixture").checked ? "表示値は開発用仮値です。数値はDTOに含めず、trusted catalogからcompileします。" : "表示値はproduction balance v0です。1キャラにつき1候補、選択コストなし。数値はDTOに含めません。";
}
function update() {
  stale();
  try {
    renderChoices();
    const validation = validateBSkillSelection(selection, { catalog });
    compilation = compileBSkill(selection, { catalog });
    $("selection").textContent = json(selection); $("validation").textContent = json(validation); $("compiled").textContent = json(compilation.bSkills);
    $("compile-status").textContent = !validation.valid ? "不正な選択です。errorsを確認してください。"
      : compilation.ok ? "選択はvalid・compile成功です。" : "選択はvalidですが、未確定値があります。unresolvedを確認してください。";
    $("battle").disabled = !compilation.ok;
    $("battle-blocker").textContent = compilation.ok ? "実行時に再compileし、P1へ装備して戦闘します。" : "compile不可のため戦闘できません。開発fixtureで仮値を使えます。";
  } catch (error) { compilation = null; $("battle").disabled = true; $("compiled").textContent = "null"; $("compile-status").textContent = `設定エラー：${error.message}`; }
}
function renderEvents() {
  $("events").replaceChildren();
  for (const event of lastRun?.battle.events ?? []) {
    if ($("important-only").checked && !important.has(event.type)) continue;
    const row = el("tr");
    for (const value of [event.turn, event.phase, event.actor, event.type]) row.append(el("td", value));
    const cell = el("td");
    const main = Object.fromEntries(Object.entries(event).filter(([key]) => !["id", "turn", "phase", "actor", "type", "state", "meta", "attack", "originSkill", "groupId"].includes(key)));
    cell.append(el("span", JSON.stringify(main)));
    const details = el("details"); details.append(el("summary", "raw JSON（originSkill / groupIdを含む）"), el("pre", json(event)));
    cell.append(details); row.append(cell); $("events").append(row);
  }
}
const defaults = createBTestSettings();
for (const field of B_TEST_FIELDS) {
  const input = el("input"); Object.assign(input, { id: field.key, type: "number", min: field.min, max: field.max, step: "1", value: field.value, required: true });
  input.addEventListener("input", stale); $("settings").append(labeled(field.label, input));
}
for (const side of ["p1", "p2"]) {
  const box = el("fieldset"); box.append(el("legend", `${side.toUpperCase()} 開始status`));
  for (const group of ["buff", "debuff"]) for (const key of STATUS_GROUPS[group]) {
    const option = catalog.optionSets[group].find(o => o.id === key);
    const input = select([0, 1, 2, 3].map(n => ({ id: String(n), label: String(n) })), String(defaults[`${side}Status`][key]), `${side}-${key}`, () => {});
    box.append(labeled(option.label, input));
  }
  $("status-settings").append(box);
}
document.querySelectorAll('input[name="b-type"]').forEach(input => input.addEventListener("change", () => { resetType(input.value); update(); }));
$("fixture").addEventListener("change", () => {
  catalog = $("fixture").checked ? createBDevCatalog() : createBSkillCatalog(); catalogNote(); update();
});
function catalogNote() { $("catalog-note").textContent = $("fixture").checked
  ? "開発fixture ON：この値は開発確認用でありゲームバランス仕様ではありません。"
  : "production balance v0：event 56・trait 14の全70候補がcompile可能です。fixtureなしで戦闘確認できます。"; }
for (const id of ["dev-heal", "heal-target", "heal-amount"]) $(id).addEventListener("input", stale);
$("important-only").addEventListener("change", renderEvents);
$("battle-form").addEventListener("submit", event => {
  event.preventDefault();
  try {
    const settings = Object.fromEntries(B_TEST_FIELDS.map(f => [f.key, $(f.key).valueAsNumber]));
    for (const side of ["p1", "p2"]) settings[`${side}Status`] = Object.fromEntries(STATUS_GROUPS.all.map(key => [key, Number($(`${side}-${key}`).value)]));
    settings.devHeal = { enabled: $("dev-heal").checked, target: $("heal-target").value, amount: $("heal-amount").valueAsNumber };
    const result = runBSkillTestBattle(selection, { catalog, settings });
    if (!result.battle) throw new Error("selectionが不正または未解決のため戦闘できません。");
    lastRun = result;
    $("battle-message").textContent = `実行完了：${result.battle.result} / ${result.battle.events.length} events（実行時の設定）`;
    $("final-state").textContent = json({ result: result.battle.result, finalSnapshot: result.finalState });
    $("battle-json").textContent = json({ fixture: $("fixture").checked, selection, settings, ...result }); renderEvents();
  } catch (error) { $("battle-message").textContent = `実行エラー：${error.message}（表示済みのログがあれば前回の結果です）`; }
});
resetType("event"); catalogNote(); update(); $("startup").textContent = "読み込み完了。";
