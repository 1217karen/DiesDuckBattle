import { createPlayerBuildStorage } from "./playerBuildStorage.js";
import { createSettingState, changeSetting, selectedDuck, SP_OPTIONS, cBranches, createCStructure, battlerSummary, duckSummary } from "./settingState.js";
import { getDiceFrame } from "./diceFrames.js";
import { createBuildRules } from "./buildRules.js";
import { createASkillCatalog, getATriggerOptions, getAEffectOptions, getAEffectAvailability } from "./aSkillCatalog.js";
import { createBSkillCatalog, getBTriggerOptions, getBConditionOptions, getBEffectOptions, getBTraitOptions, getBSelectionDefinition } from "./bSkillCatalog.js";
import { createCSkillCatalog, getCEffectOptions } from "./cSkillCatalog.js";
import { createCSkillRules } from "./cSkillRules.js";
import { D_SKILL_OPTIONS } from "./dSkillCatalog.js";

const repository = createPlayerBuildStorage();
let state = createSettingState(repository.load());
const rules = createBuildRules(), aCatalog = createASkillCatalog(), bCatalog = createBSkillCatalog();
const cCatalog = createCSkillCatalog(), cRules = createCSkillRules();
const $ = id => document.getElementById(id);
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const labelText = text => String(text).replaceAll("self", "自分").replaceAll("enemy", "相手");
const num = value => value ?? "—";
const axisLabels = { baseAmount: "基礎ダメージ", everyTurns: "何ターンごと", stepAmount: "増加ダメージ", multiplier: "状態数の倍率",
  amount: "効果量", duration: "期間（ターン）", status: "状態", scope: "解除範囲", amountPct: "現在HP割合", maxHpPct: "復活HP割合" };
function button(text, onClick, className) {
  const node = el("button", text, className); node.type = "button"; node.addEventListener("click", onClick); return node;
}
function confirmChange(message, onConfirm) {
  const dialog = el("dialog", null, "confirm-dialog");
  dialog.setAttribute("aria-labelledby", "confirm-heading");
  const heading = el("h3", "設定の変更を確認"); heading.id = "confirm-heading";
  const actions = el("div", null, "actions");
  actions.append(button("取り消す", () => dialog.close()), button("変更する", () => {
    dialog.close(); onConfirm();
  }, "primary"));
  dialog.append(heading, el("p", message), actions);
  dialog.addEventListener("close", () => { dialog.remove(); render(); }, { once: true });
  document.body.append(dialog); dialog.showModal();
}
function labeled(text, input) { const label = el("label", text); label.append(input); return label; }
function select(id, items, current, onChange, placeholder = "選択してください") {
  const input = el("select"); input.id = id;
  const add = (item, parent = input) => {
    const option = el("option", labelText(item.label)); option.value = item.id; option.disabled = !!item.disabled; parent.append(option);
  };
  if (placeholder !== null) add({ id: "", label: placeholder });
  const groups = new Map();
  for (const item of items) {
    if (!item.group) add(item);
    else {
      if (!groups.has(item.group)) { const group = el("optgroup"); group.label = item.group; groups.set(item.group, group); input.append(group); }
      add(item, groups.get(item.group));
    }
  }
  const value = current == null ? "" : String(current);
  if (value && !items.some(item => String(item.id) === value)) add({ id: value, label: `${value}（現在は使用不可）` });
  input.value = value;
  input.addEventListener("change", () => onChange(input.value));
  return input;
}
function field(box, text, id, items, current, onChange, placeholder) {
  box.append(labeled(text, select(id, items, current, onChange, placeholder)));
}
function card(title, key) {
  const box = el("section", null, "card"), heading = el("div", null, "card-header");
  box.setAttribute("aria-label", title);
  const badge = el("span", null, "badge"); badge.id = `${key}-status`;
  heading.append(el("h3", title), badge); box.append(heading); return box;
}
function feedback(box, key) { const list = el("ul", null, "issues"); list.id = `${key}-issues`; box.append(list); }
function setFeedback(key, summary) {
  const badge = $(`${key}-status`); if (!badge) return;
  badge.textContent = summary.label;
  badge.className = "badge" + (summary.label === "設定完了" ? " good" : summary.label.includes("問題") || summary.label.includes("不正") ? " warning" : "");
  $(`${key}-issues`)?.replaceChildren(...summary.messages.map(message => el("li", message)));
}
function commit(action, redraw = true) {
  state = changeSetting(state, action);
  if (action.type !== "select") $("save-message").textContent = "未保存の変更があります";
  if (redraw) render(); else { renderTabs(); renderSummaries(); }
}
const patchDuck = (patch, redraw = true) => commit({ type: "duck", patch }, redraw);
const patchBattler = patch => commit({ type: "battler", patch });

function renderBattler() {
  const { bSelection: b, dSelection: d } = state.build.battler;
  const bBox = card("B SKILL / Bスキル", "b"), controls = el("div", null, "controls");
  const incomplete = [{ id: "incomplete", label: "未完了（選択してください）", disabled: true }];
  field(controls, "Bスキルの種類", "b-type", [{ id: "event", label: "イベント型" }, { id: "trait", label: "特性型" },
    ...(b !== null && !b.type ? incomplete : [])], b === null ? "" : b.type || "incomplete",
    type => patchBattler({ bSelection: !type ? null : type === "event"
      ? { type, triggerId: "", conditionId: "", effectId: "", options: {} } : { type, traitId: "", options: {} } }), "未設定");
  const setB = patch => patchBattler({ bSelection: { ...b, ...patch } });
  if (b?.type === "event") {
    field(controls, "発動タイミング", "b-trigger", getBTriggerOptions(bCatalog), b.triggerId, triggerId => setB({ triggerId }));
    field(controls, "条件", "b-condition", getBConditionOptions(b.triggerId, bCatalog), b.conditionId, conditionId => setB({ conditionId }));
    field(controls, "効果", "b-effect", getBEffectOptions(b.triggerId, b.conditionId, bCatalog).map(e => ({ id: e.effectId, label: e.effectLabel })),
      b.effectId, effectId => setB({ effectId, options: {} }));
  } else if (b?.type === "trait") field(controls, "特性", "b-trait", getBTraitOptions(bCatalog), b.traitId, traitId => setB({ traitId, options: {} }));
  const definition = getBSelectionDefinition(b, bCatalog);
  for (const [axis, group] of Object.entries(definition?.optionAxes ?? {})) field(controls, "指定する状態", `b-${axis}`, bCatalog.optionSets[group],
    b.options?.[axis], value => setB({ options: { ...b.options, [axis]: value } }));
  bBox.append(controls);
  if (definition) {
    const description = [labelText(definition.effectLabel ?? definition.label), ...Object.entries(definition.tuning)
      .map(([key, value]) => `${definition.tuningLabels[key]}：${value === false ? "上限なし" : value}`)].join(" / ");
    bBox.append(el("p", description, "description"));
  }
  feedback(bBox, "b");
  const dBox = card("D SKILL / Dスキル", "d");
  dBox.append(el("p", "戦闘開始時に1回、選んだダイスを1個追加します。", "description"));
  field(dBox, "追加するダイス", "d-option", [...D_SKILL_OPTIONS, ...(d !== null && !d.optionId ? incomplete : [])], d === null ? "" : d.optionId || "incomplete",
    optionId => patchBattler({ dSelection: optionId ? { optionId } : null }), "未設定");
  feedback(dBox, "d");
  $("battler-editor").replaceChildren(bBox, dBox);
}

function renderTabs() {
  $("duck-tabs").replaceChildren(...state.build.ducks.map((duck, index) => {
    const tab = button(duck.name || `アヒル ${index + 1}`, () => commit({ type: "select", id: duck.id }));
    tab.id = `duck-tab-${index}`; tab.setAttribute("aria-pressed", String(duck.id === state.selectedDuckId));
    tab.setAttribute("aria-controls", "duck-editor"); return tab;
  }));
}
function renderStats(duck, box) {
  const statBox = card("STATUS / 能力", "stats"), grid = el("div", null, "stat-grid");
  for (const key of ["AT", "DF"]) {
    const input = el("input"); input.id = `stat-${key}`; input.type = "number"; input.step = "1";
    input.min = rules.stats[key].min; input.max = rules.stats[key].max; input.value = duck.stats[key] ?? ""; input.placeholder = "未入力";
    input.addEventListener("input", () => patchDuck({ stats: { ...selectedDuck(state).stats,
      [key]: Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : null } }, false));
    grid.append(labeled(key, input));
  }
  field(grid, "SP", "stat-SP", SP_OPTIONS.map(o => ({ id: o.id, label: `SP ${o.SP}` })), duck.diceFrame,
    frame => commit({ type: "sp", frame: frame || null }), "未設定");
  const metrics = el("div", null, "metrics"); metrics.id = "stat-metrics";
  statBox.append(grid, metrics, el("p", `ATは${rules.stats.AT.min}～${rules.stats.AT.max}、DFは${rules.stats.DF.min}～${rules.stats.DF.max}。SPを含む合計上限は${rules.stats.totalMax}。HPは能力から計算します。`, "description"));
  feedback(statBox, "stats"); box.append(statBox);
  const diceBox = card("DICE / ダイス", "dice"), diceGrid = el("div", null, "dice-grid"), frame = getDiceFrame(duck.diceFrame);
  duck.dice.forEach((face, index) => field(diceGrid, `枠 ${index + 1}`, `dice-${index}`,
    [0, ...(frame?.faces ?? [])].map(value => ({ id: String(value), label: value === 0 ? "0（空き）" : String(value) })), face,
    value => { const dice = [...selectedDuck(state).dice]; dice[index] = Number(value); patchDuck({ dice }); }, null));
  diceBox.append(diceGrid, el("p", `${rules.dice.slots}枠。同じ非0出目は${rules.dice.maxSameFace}個まで。0がある場合は${rules.dice.maxSameFaceWithEmpty}個まで。空き1枠で${rules.resources.dicePointsPerEmpty}pt獲得、3個積み1種類につき${rules.resources.dicePointsPerTriple}pt消費。`, "description"));
  const diceMetrics = el("div", null, "metrics"); diceMetrics.id = "dice-metrics"; diceBox.append(diceMetrics);
  feedback(diceBox, "dice"); box.append(diceBox);
}

function renderA(duck, box) {
  const panel = card("A SKILL / Aスキル", "a"), a = duck.aSelection;
  field(panel, "Aスキルの設定", "a-enabled", [{ id: "on", label: "設定する" }], a === null ? "" : "on",
    value => patchDuck({ aSelection: value ? { triggerId: "", effects: [] } : null }), "未設定");
  if (a !== null) {
    field(panel, "発動条件", "a-trigger", getATriggerOptions(duck.diceFrame, aCatalog).map(o => ({ ...o, label: `${o.label} / ${o.pointCost}pt` })), a.triggerId,
      triggerId => patchDuck({ aSelection: { ...a, triggerId } }));
    const effects = a.effects ?? [];
    const setRows = rows => patchDuck({ aSelection: { ...a, effects: rows } });
    const groups = getAEffectOptions(duck.diceFrame, a.triggerId, aCatalog);
    effects.forEach((chosen, index) => {
      const row = el("div", null, "effect-row"), head = el("div", null, "row-heading"), controls = el("div", null, "controls");
      head.append(el("strong", `効果 ${index + 1}`), button("削除", () => setRows(effects.filter((_, i) => i !== index))));
      const replace = value => setRows(effects.map((old, i) => i === index ? value : old));
      field(controls, "効果", `a-effect-${index}`, groups.flatMap(g => g.effects.map(e => ({ id: e.id, group: g.label,
        label: `${e.label}${e.polarity === "drawback" ? "（代償）" : ""}${!e.selectable ? " — " + e.reason.message : ""}`, disabled: !e.selectable }))),
      chosen?.effectId, effectId => replace({ effectId }));
      const definition = aCatalog.effects.find(e => e.id === chosen?.effectId);
      if (definition?.requiresAmount) field(controls, "効果量", `a-amount-${index}`, definition.amountOptions.map(o => ({ ...o,
        label: `${o.label} / ${definition.polarity === "drawback" ? `還元 ${o.drawbackPoints ?? definition.drawbackPoints}` : o.pointCost}pt` })), chosen.amountOptionId,
      value => { const next = { ...chosen }; if (value) next.amountOptionId = value; else delete next.amountOptionId; replace(next); });
      if (definition?.polarity === "benefit") field(controls, "成功率", `a-chance-${index}`, aCatalog.chanceOptions, chosen.chanceOptionId ?? "100",
        value => replace({ ...chosen, chanceOptionId: value }), null);
      row.append(head, controls);
      if (definition) {
        const availability = getAEffectAvailability(definition.id, duck.diceFrame, a.triggerId, aCatalog);
        row.append(el("p", labelText(definition.label) + (definition.polarity === "drawback" ? " / 代償効果・成功率100%固定" : ""), "description"));
        if (!availability.selectable) row.append(el("p", availability.reason.message, "issues"));
      }
      panel.append(row);
    });
    const add = button("＋ A効果を追加", () => setRows([...effects, { effectId: "" }]));
    add.disabled = effects.length >= aCatalog.maxEffects; panel.append(add);
    panel.append(el("p", `効果は最大${aCatalog.maxEffects}件。上から順に実行します。`, "description"));
  }
  const metrics = el("div", null, "metrics"); metrics.id = "a-metrics"; panel.append(metrics); feedback(panel, "a"); box.append(panel);
}

function renderC(duck, box) {
  const panel = card("C SKILL / Cスキル", "c"), c = duck.cSelection;
  const hasEffects = cBranches(c).some(({ branch }) => branch?.effects?.length);
  field(panel, "Cスキルの種類", "c-mode", [{ id: "normal", label: "通常C" }, { id: "special", label: "特殊C" },
    ...(c !== null && !c.mode ? [{ id: "incomplete", label: "未完了（選択してください）", disabled: true }] : [])], c === null ? "" : c.mode || "incomplete",
    mode => {
      if (!mode) { patchDuck({ cSelection: null }); return; }
      if (c === null) { patchDuck({ cSelection: { mode, structure: createCStructure("flat") } }); return; }
      if (mode === "special" && c.structure?.kind !== "flat") {
        const change = () => patchDuck({ cSelection: { mode, structure: createCStructure("flat") } });
        if (hasEffects) confirmChange("特殊Cは分岐なしです。現在の分岐・効果をクリアしますか？", change);
        else change();
      } else patchDuck({ cSelection: { ...c, mode } });
    }, "未設定");
  if (c !== null) {
    const structure = c.structure;
    const kind = structure?.kind === "random" ? `random${structure.branches?.length}` : structure?.kind;
    const structures = [{ id: "flat", label: "分岐なし" }, ...Object.keys(cRules.branchAPDelta).filter(key => key !== "flat")
      .map(id => ({ id, label: id === "hpCondition" ? "HP条件" : `ランダム ${id.at(-1)}分岐` }))];
    field(panel, "分岐方式", "c-structure", c.mode === "special" ? structures.filter(o => o.id === "flat") : structures, kind,
        value => {
          const change = () => patchDuck({ cSelection: { ...c, structure: createCStructure(value) } });
          if (hasEffects) confirmChange("分岐方式を変更すると、現在のC効果をクリアします。変更しますか？", change);
          else change();
      }, null);
    if (structure?.kind === "hpCondition") field(panel, "自分のHP割合", "c-threshold", cCatalog.optionSets.hpThreshold,
      structure.thresholdOptionId, value => {
        const next = { ...structure }; if (value) next.thresholdOptionId = value; else delete next.thresholdOptionId;
        patchDuck({ cSelection: { ...c, structure: next } });
      });
    const branches = cBranches(c), count = branches.reduce((sum, { branch }) => sum + (branch?.effects?.length ?? 0), 0);
    const available = getCEffectOptions(c.mode, cCatalog);
    for (const { key, label, branch } of branches) {
      const branchBox = el("div", null, "branch"), effects = branch?.effects ?? [];
      branchBox.append(el("h4", label));
      const setRows = effects => {
        const next = structuredClone(c);
        if (key === "flat") next.structure.effects = effects;
        else {
          // A persisted draft can have a mismatched branch container. Repair only
          // the container explicitly being edited, retaining any named branches.
          if (next.structure.kind === "hpCondition" && Array.isArray(next.structure.branches)) next.structure.branches = {};
          next.structure.branches ??= {};
          next.structure.branches[key] = { ...branch, effects };
        }
        patchDuck({ cSelection: next });
      };
      effects.forEach((chosen, index) => {
        const row = el("div", null, "effect-row"), head = el("div", null, "row-heading"), controls = el("div", null, "controls");
        head.append(el("strong", `効果 ${index + 1}`), button("削除", () => setRows(effects.filter((_, i) => i !== index))));
        const replace = value => setRows(effects.map((old, i) => i === index ? value : old));
        field(controls, "効果", `c-effect-${key}-${index}`, available.map(e => ({ id: e.id,
          label: `${e.label}${e.polarity === "drawback" ? "（代償）" : ""}${!e.selectable ? " — 特殊C専用" : ""}`, disabled: !e.selectable })),
        chosen?.effectId, effectId => replace({ effectId, options: {} }));
        const definition = available.find(e => e.id === chosen?.effectId);
        for (const [axis, options] of Object.entries(definition?.options ?? {})) field(controls, axisLabels[axis] ?? axis, `c-${axis}-${key}-${index}`,
          options, chosen?.options?.[axis], value => {
            const options = { ...chosen.options }; if (value) options[axis] = value; else delete options[axis]; replace({ ...chosen, options });
          });
        if (definition?.polarity === "benefit" && definition.chanceEnabled) field(controls, "成功率", `c-chance-${key}-${index}`,
          cCatalog.chanceOptions, chosen.chanceOptionId ?? "100", value => replace({ ...chosen, chanceOptionId: value }), null);
        row.append(head, controls);
        if (definition) row.append(el("p", labelText(definition.label) + (definition.polarity === "drawback" ? " / 代償効果・成功率100%固定" : ""), "description"));
        branchBox.append(row);
      });
      const add = button("＋ C効果を追加", () => setRows([...effects, { effectId: "", options: {} }]));
      add.disabled = count >= cRules.maxEffects; branchBox.append(add); panel.append(branchBox);
    }
    panel.append(el("p", `全分岐の効果を合計して${cRules.minEffects}～${cRules.maxEffects}件。各分岐に効果を設定してください。`, "description"));
  }
  const metrics = el("div", null, "metrics"); metrics.id = "c-metrics"; panel.append(metrics); feedback(panel, "c"); box.append(panel);
}
function renderDuck() {
  const box = $("duck-editor"); box.replaceChildren(); const duck = selectedDuck(state);
  if (!duck) { box.append(el("p", "アヒル設定はまだありません。「＋ 新規アヒル」から作成できます。", "empty")); return; }
  const meta = el("div", null, "duck-meta"), name = el("input"); name.id = "duck-name"; name.value = duck.name; name.placeholder = "例：基本型";
  name.addEventListener("input", () => patchDuck({ name: name.value }, false));
  const actions = el("div", null, "actions");
  actions.append(button("複製", () => commit({ type: "duplicate" })), button("削除", () => {
    confirmChange(`「${selectedDuck(state).name || "名前未設定のアヒル"}」を削除しますか？保存するまで確定しません。`, () => commit({ type: "delete" }));
  }, "danger"));
  meta.append(labeled("設定名", name), actions); box.append(meta);
  renderStats(duck, box); renderA(duck, box); renderC(duck, box);
}
function renderSummaries() {
  const battler = battlerSummary(state.build.battler); setFeedback("b", battler.B); setFeedback("d", battler.D);
  const duck = selectedDuck(state); if (!duck) return;
  const summary = duckSummary(duck);
  for (const key of ["stats", "dice"]) setFeedback(key, summary[key]);
  setFeedback("a", summary.A); setFeedback("c", summary.C);
  $("stat-metrics").textContent = `合計 ${num(summary.stats.total)} / ${rules.stats.totalMax}　　HP ${num(summary.stats.hp)}`;
  const dice = summary.dice.resources;
  $("dice-metrics").textContent = `ダイス資源　獲得 ${num(dice?.earned)}pt / 消費 ${num(dice?.spent)}pt / 残り ${num(dice?.remaining)}pt`;
  const a = summary.A.resources;
  $("a-metrics").textContent = `利用可能 ${num(a.availablePoints)}pt / 消費（還元後）${num(a.netCost)}pt / 残り ${num(a.remaining)}pt`;
  $("c-metrics").textContent = `必要AP ${num(summary.C.resources.requiredAP)}`;
}
function render() {
  const focused = document.activeElement?.id;
  renderBattler(); renderTabs(); renderDuck(); renderSummaries();
  if (focused) $(focused)?.focus({ preventScroll: true });
}
const storageMessages = {
  corrupt: "保存データを読み込めませんでした。保存形式が壊れているため、既存データを保護して編集・保存を停止しています。",
  "unsupported-version": "このページでは対応していないバージョンの保存データです。対応するページで開いてください。",
  "storage-error": "保存領域にアクセスできませんでした。ブラウザの保存許可・空き容量などを確認してください。",
  "invalid-build": "保存できない形式が含まれています。設定内容を確認してください。",
};
$("add-duck").addEventListener("click", () => commit({ type: "add" }));
$("save").addEventListener("click", () => {
  if (!state.build) return;
  const result = repository.save(state.build);
  if (result.ok) { state = { ...state, dirty: false }; $("save-message").textContent = "保存しました"; }
  else $("save-message").textContent = storageMessages[result.status] ?? "保存できませんでした。";
});
window.addEventListener("beforeunload", event => { if (state.dirty) { event.preventDefault(); event.returnValue = ""; } });
if (state.build) {
  $("editor").hidden = false; $("load-message").hidden = true; render();
} else {
  $("load-message").textContent = storageMessages[state.loadStatus] ?? "保存データを読み込めませんでした。";
  $("save").disabled = true;
}
