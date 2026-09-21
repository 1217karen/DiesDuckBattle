// Aスキル仕様確認用・開発ページ。保存/戦闘適用/ビルド合法性判定は行わない。
import { DICE_FRAMES, getDiceFrame } from "./diceFrames.js";
import { createBuildRules } from "./buildRules.js";
import { calculateBuildResources } from "./buildResources.js";
import { createASkillCatalog, getATriggerOptions, getAEffectOptions, getAEffectAvailability } from "./aSkillCatalog.js";
import { calculateASkillResources } from "./aSkillResources.js";

const $ = id => document.getElementById(id);
const rules = createBuildRules();
const state = {
  frame: "light", dice: Array(rules.dice.slots).fill(0), triggerId: "exact:0",
  rows: [{ categoryId: "damage", effectId: "damage-enemy" }],
};
let catalog = createPageCatalog(false);

function createPageCatalog(fixture) {
  const independent = createASkillCatalog();
  if (fixture) {
    // 開発確認用・ゲーム仕様ではない。本番の定義を変更/保存しない。
    for (const effect of independent.effects) {
      if (effect.requiresAmount) effect.amountOptions = [
        { id: "test-small", label: "仮：小", value: 1, pointCost: 1 },
        { id: "test-medium", label: "仮：中", value: 2, pointCost: 2 },
        { id: "test-large", label: "仮：大", value: 3, pointCost: 3 },
      ];
      else effect.pointCost = 0;
    }
  }
  return independent;
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function option(id, label, disabled = false) {
  const node = element("option", label); node.value = id; node.disabled = disabled; return node;
}
function labelled(text, control) { const label = element("label", text); label.append(control); return label; }
function points(value, sign = "") { return value == null ? "未確定" : `${sign}${value}pt`; }
function effectLabel(effect) {
  return `${effect.label}（${effect.polarity === "drawback" ? `デメリット +${effect.drawbackPoints}pt` : "メリット"}）`;
}
function normalizeAmount(row) {
  const effect = catalog.effects.find(item => item.id === row.effectId);
  if (!effect?.requiresAmount || !effect.amountOptions.length) delete row.amountOptionId;
  else if (!effect.amountOptions.some(item => item.id === row.amountOptionId)) row.amountOptionId = effect.amountOptions[0].id;
}

function renderInputs() {
  const frame = getDiceFrame(state.frame);
  $("frame").value = state.frame;
  $("frame-info").textContent = `SP ${frame.SP} / 選べる出目：0, ${frame.faces.join(", ")}`;
  $("dice").replaceChildren();
  state.dice.forEach((face, index) => {
    const select = element("select"); select.id = `dice-${index}`;
    for (const value of [0, ...frame.faces]) select.append(option(value, value === 0 ? "0（空き）" : String(value)));
    select.value = face;
    select.addEventListener("change", () => { state.dice[index] = Number(select.value); renderResult(); });
    $("dice").append(labelled(`枠${index + 1}`, select));
  });
  const triggers = getATriggerOptions(state.frame, catalog);
  if (!triggers.some(item => item.id === state.triggerId)) state.triggerId = triggers[0].id;
  $("trigger").replaceChildren(...triggers.map(item => option(item.id, `${item.label} / ${points(item.pointCost)}`)));
  $("trigger").value = state.triggerId;
  renderRows(); renderResult();
}

function renderRows() {
  const groups = getAEffectOptions(state.frame, state.triggerId, catalog);
  $("effects").replaceChildren();
  if (!state.rows.length) $("effects").append(element("p", "効果はまだありません。＋効果を追加から追加できます。", "muted"));
  state.rows.forEach((row, index) => {
    normalizeAmount(row);
    const wrapper = element("div", null, "effect-row");
    const heading = element("div", null, "row-heading");
    heading.append(element("strong", `効果 ${index + 1}`));
    const remove = element("button", "削除"); remove.type = "button";
    remove.setAttribute("aria-label", `効果${index + 1}を削除`);
    remove.addEventListener("click", () => { state.rows.splice(index, 1); renderRows(); renderResult(); });
    heading.append(remove); wrapper.append(heading);
    const controls = element("div", null, "effect-controls");
    const category = element("select"); category.id = `category-${index}`;
    category.append(...groups.map(group => option(group.id, group.label))); category.value = row.categoryId;
    category.addEventListener("change", () => {
      row.categoryId = category.value;
      row.effectId = groups.find(group => group.id === row.categoryId).effects.find(item => item.selectable)?.id ?? "";
      delete row.amountOptionId; renderRows(); renderResult();
    });
    controls.append(labelled(`効果${index + 1} カテゴリ`, category));
    const group = groups.find(item => item.id === row.categoryId);
    const effectSelect = element("select"); effectSelect.id = `effect-${index}`;
    effectSelect.append(option("", "効果を選択してください"));
    for (const effect of group.effects) {
      const item = option(effect.id, effectLabel(effect), !effect.selectable);
      if (effect.reason) item.title = effect.reason.message;
      effectSelect.append(item);
    }
    effectSelect.value = row.effectId;
    effectSelect.addEventListener("change", () => { row.effectId = effectSelect.value; delete row.amountOptionId; renderRows(); renderResult(); });
    controls.append(labelled(`効果${index + 1} 内容`, effectSelect));
    const effect = group.effects.find(item => item.id === row.effectId);
    const amount = element("select"); amount.id = `amount-${index}`;
    if (effect?.requiresAmount && effect.amountOptions.length) {
      amount.append(...effect.amountOptions.map(item => option(item.id, `${item.label} / ${points(item.pointCost)}`)));
      amount.value = row.amountOptionId;
    } else {
      amount.disabled = true;
      amount.append(option("", !effect ? "効果を選択してください" : effect.requiresAmount ? "効果量候補なし（未設定）" : "数量指定なし"));
    }
    amount.addEventListener("change", () => { row.amountOptionId = amount.value; renderResult(); });
    controls.append(labelled(`効果${index + 1} 効果量`, amount)); wrapper.append(controls);
    if (effect) {
      wrapper.append(element("p", effectLabel(effect), `row-note ${effect.polarity}`));
      if (!effect.requiresAmount) wrapper.append(element("p", `効果コスト：${points(effect.pointCost)}`, "muted"));
      const availability = getAEffectAvailability(effect.id, state.frame, state.triggerId, catalog);
      if (!availability.selectable) wrapper.append(element("p", `現在は選択不可：${availability.reason.message}`, "drawback"));
    }
    const disabled = group.effects.filter(item => !item.selectable);
    if (disabled.length) {
      const reasons = element("ul", null, "availability");
      for (const item of disabled) reasons.append(element("li", `${item.label}：${item.reason.message}`));
      wrapper.append(reasons);
    }
    $("effects").append(wrapper);
  });
}

function renderResult() {
  // AT/DFは開発確認用の固定値。A作成選択は既存build.skillsへ混ぜない。
  const build = { schemaVersion: 1, diceFrame: state.frame, stats: { AT: 1, DF: 1 }, dice: [...state.dice], skills: [] };
  const selection = { triggerId: state.triggerId, effects: state.rows.map(row => ({
    effectId: row.effectId, ...(row.amountOptionId ? { amountOptionId: row.amountOptionId } : {}),
  })) };
  const resources = calculateBuildResources(build, rules);
  const result = calculateASkillResources(build, selection, { rules, catalog });
  $("dice-resource").textContent = `ダイスpt：獲得 ${resources.dice.earned} / 3個積み使用 ${resources.dice.spent} / 残り ${resources.dice.remaining}`;
  $("trigger-cost").textContent = `コスト：${points(result.triggerCost)}`;
  $("points").replaceChildren();
  for (const [key, label, sign] of [
    ["availableDicePoints", "ダイス由来pt", ""], ["triggerCost", "発動条件コスト", "−"],
    ["effectCost", "効果コスト", "−"], ["drawbackPoints", "デメリットpt", "+"],
    ["grossCost", "grossCost（条件＋効果）", ""], ["netCost", "netCost（還元差引後）", ""],
    ["remaining", "残り", ""], ["complete", "complete", ""],
    ["knownEffectCost", "判明済み効果コスト", ""], ["knownDrawbackPoints", "判明済みデメリットpt", ""],
  ]) {
    const line = element("div", null, `point-line ${key}`);
    const value = element("dd", key === "complete" ? String(result[key]) : points(result[key], sign));
    value.id = `point-${key}`;
    if (typeof result[key] === "number" && result[key] < 0) value.className = "negative";
    line.append(element("dt", label), value); $("points").append(line);
  }
  for (const key of ["errors", "unresolved"]) {
    $(key).replaceChildren(...(result[key].length ? result[key].map(item => element("li",
      `${item.code} — ${item.path}${item.message ? `：${item.message}` : ""}`)) : [element("li", "なし")]));
  }
  $("debug").textContent = JSON.stringify({ build, selection, resources, result }, null, 2);
}

const frameLabels = { light: "ライト", basic: "ベーシック", heavy: "ヘビー" };
$("frame").append(...Object.keys(DICE_FRAMES).map(id => option(id, frameLabels[id] ?? id)));
$("frame").addEventListener("change", () => {
  state.frame = $("frame").value;
  const allowed = [0, ...getDiceFrame(state.frame).faces];
  const replaced = state.dice.filter(face => !allowed.includes(face)).length;
  state.dice = state.dice.map(face => allowed.includes(face) ? face : 0);
  $("frame-reset").textContent = replaced ? `新しい素体で使えない${replaced}枠を0に戻しました。` : "";
  renderInputs();
});
$("trigger").addEventListener("change", () => { state.triggerId = $("trigger").value; renderRows(); renderResult(); });
$("fixture").addEventListener("change", () => {
  catalog = createPageCatalog($("fixture").checked);
  $("mode-note").textContent = $("fixture").checked
    ? "仮値モード ON：開発確認用・ゲーム仕様ではない（仮：小／中／大、仮価格1／2／3pt）"
    : "本番カタログ：効果量・価格は未設定です。";
  renderInputs();
});
$("add-effect").addEventListener("click", () => {
  const group = getAEffectOptions(state.frame, state.triggerId, catalog)[0];
  state.rows.push({ categoryId: group.id, effectId: group.effects.find(item => item.selectable)?.id ?? "" });
  renderRows(); renderResult();
});
renderInputs();
$("startup").hidden = true;
