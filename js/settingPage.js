import { effectSelectionFields } from "./effectSelectionCatalog.js";
import { selectionRows } from "./selectionNormalization.js";
import { createPlayerBuildStorage } from "./playerBuildStorage.js";
import { createPlayerPublicSettingsStorage } from "./playerPublicSettingsStorage.js";
import { createSettingState, changeSetting, selectedDuck, selectedPublicDuckId, cBranches, createCStructure, duckSummary } from "./settingState.js";
import { inspectBuildForSave, saveSectionSummary, saveInspectedBuild } from "./buildSaveInspection.js";
import { DICE_FRAMES, getDiceFrame } from "./diceFrames.js";
import { createBuildRules } from "./buildRules.js";
import { createASkillCatalog, getATriggerOptions } from "./aSkillCatalog.js";
import { aEditorLeaf, aNormalSlots, aEditorCatalog, aCancelAvailable, isACancel, setAAttackCancel, addANormalEffect, removeANormalEffect, changeAClause, changeATrigger } from "./aSkillSentenceEditor.js";
import { aTriggerText, aContentText, aClauseText, aEnding, aDrawbackText, aStatusText, aEffectPointText, aCancelPointText, aPointSections } from "./aSkillPresentation.js";
import { calculateASkillResources } from "./aSkillResources.js";
import { createBSkillCatalog, getBTriggerOptions, getBConditionOptions, getBEffectOptions } from "./bSkillCatalog.js";
import { bEffectText, bSentence } from "./bSkillPresentation.js";
import { bEventEditorSelection, bEventEditorDefinition, changeBEvent } from "./bSkillSentenceEditor.js";
import { createCSkillCatalog } from "./cSkillCatalog.js";
import { createCSkillRules } from "./cSkillRules.js";
import { cControlDefinitions, changeCControl } from "./cSkillControlEditor.js";
import { D_SKILL_OPTIONS } from "./dSkillCatalog.js";

const repository = createPlayerBuildStorage();
const loaded = repository.load();
const publicRepository = createPlayerPublicSettingsStorage();
const publicLoaded = publicRepository.load();
let state = createSettingState(loaded, publicLoaded);
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
function button(text, onClick, className) {
  const node = el("button", text, className); node.type = "button"; node.addEventListener("click", onClick); return node;
}
function showDialog({ title, message, issues = [], onConfirm, confirmLabel = "変更する", cancelLabel = "取り消す" }) {
  const dialog = el("dialog", null, "confirm-dialog");
  dialog.setAttribute("aria-labelledby", "confirm-heading");
  const heading = el("h3", title); heading.id = "confirm-heading";
  const actions = el("div", null, "actions");
  actions.append(button(cancelLabel, () => dialog.close()));
  if (onConfirm) actions.append(button(confirmLabel, () => {
    dialog.close(); onConfirm();
  }, "primary"));
  const list = el("ul", null, "dialog-issues");
  const sections = { stats: "ステータス", dice: "ダイス", ducks: "アヒル設定", build: "保存形式" };
  for (const issue of issues) list.append(el("li", `${issue.ownerName} / ${sections[issue.section] ?? issue.section + "スキル"}：${issue.message}`));
  dialog.append(heading, list, el("p", message), actions);
  dialog.addEventListener("close", () => { dialog.remove(); render(); }, { once: true });
  document.body.append(dialog); dialog.showModal();
}
function confirmChange(message, onConfirm) { showDialog({ title: "設定の変更を確認", message, onConfirm }); }
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
  badge.className = "badge" + (summary.invalid.length ? " invalid" : summary.incomplete.length ? " warning" : " good");
  const issues = [...summary.invalid.map(i => ({ ...i, severity: "invalid" })), ...summary.incomplete.map(i => ({ ...i, severity: "warning" }))];
  const seen = new Set();
  $(`${key}-issues`)?.replaceChildren(...issues.filter(i => {
    const key = i.severity + i.message; if (seen.has(key)) return false; seen.add(key); return true;
  }).map(i => el("li", i.message, i.severity)));
}
function commit(action, redraw = true) {
  state = changeSetting(state, action);
  if (action.type !== "select") $("save-message").textContent = "未保存の変更があります";
  if (redraw) render(); else { renderTabs(); renderSummaries(); }
}
const patchDuck = (patch, redraw = true) => commit({ type: "duck", patch }, redraw);
const patchBattler = patch => commit({ type: "battler", patch });

// Catalog-driven normalized leaf editor: parameters stay separate from effect labels.
function cField(box, text, id, items, current, onChange, placeholder) {
  const legal = items.filter(item => !item.disabled);
  if (legal.length !== 1) { field(box, text, id, items, current, onChange, placeholder); return; }
  const only = legal[0], valid = current === only.id;
  const value = el("span", valid ? labelText(only.label)
    : `${current ? `現在は使用不可：${current}` : "未選択"}（固定値：${labelText(only.label)}）`, "c-fixed-value");
  value.id = id;
  const control = el("div", null, "c-fixed-control");
  control.append(el("span", text), value);
  if (!valid) control.append(button(`${labelText(only.label)}に設定`, () => onChange(only.id)));
  box.append(control);
}
function renderEffectControls(box, category, chosen, replace, id, context = {}) {
  chosen ??= {effectId:"",options:{}};
  const catalog = category === "A" ? aCatalog : category === "B" ? bCatalog : cCatalog;
  const definitions = category === "C" ? cControlDefinitions(catalog, context) : selectionRows(category,catalog,context);
  const controlField = category === "C" ? cField : field;
  controlField(box,"効果",id,definitions,chosen.effectId,effectId => replace(category === "C"
    ? changeCControl(chosen, "effectId", effectId, catalog, context) : {effectId,options:{}}));
  const view = effectSelectionFields(definitions,chosen);
  const put = (key,value) => {
    if (category === "C") { replace(changeCControl(chosen, key, value, catalog, context)); return; }
    const next = {...chosen};
    if(key.startsWith("options.")) next.options={...chosen.options,[key.slice(8)]:value};
    else if(key==="chanceOptionId" && !value) delete next[key];
    else next[key]=value;
    replace(next);
  };
  const order = key => key === "targetId" ? 1 : key === "statusId" ? 2 : key === "options.amount" ? 3 : 5;
  const fields = [...view.fields];
  if(view.chanceEnabled || Object.hasOwn(chosen,"chanceOptionId")) fields.push({key:"chanceOptionId",label:"成功率",options:view.chanceEnabled?catalog.chanceOptions:category==="A"?[catalog.chanceOptions[0]]:[],placeholder:view.chanceEnabled?null:"指定を解除"});
  fields.sort((a,b)=>(a.key==="chanceOptionId"?4:order(a.key))-(b.key==="chanceOptionId"?4:order(b.key)));
  for(const f of fields) controlField(box,f.label,id+"-"+f.key,f.options,
    f.key.startsWith("options.")?chosen.options?.[f.key.slice(8)]:chosen[f.key]??(f.key==="chanceOptionId"?"100":""),
    value=>put(f.key,value),f.key==="chanceOptionId"?f.placeholder:undefined);
  if(view.variants.length && !view.chanceEnabled && category!=="B") box.append(el("p","成功率100%固定", "description"));
}

let bTraitPath = { category: "", condition: "" };
function sentenceChoice(box, id, items, current, onChange, ariaLabel) {
  if (items.length === 1 && items[0].id === current) box.append(el("span", items[0].label, "b-fixed-clause"));
  else {
    const input = select(id, items, items.some(o => o.id === current) ? current : "", onChange);
    input.setAttribute("aria-label", ariaLabel); box.append(input);
  }
}
function renderBSentence(controls, b) {
  const sentence = el("div", null, "b-sentence-controls");
  let definition, statusId;
  if (b.type === "event") {
    const chosen = bEventEditorSelection(b, bCatalog);
    const change = (key, value) => patchBattler({ bSelection: changeBEvent(b, key, value, bCatalog) });
    sentenceChoice(sentence, "b-trigger", getBTriggerOptions(bCatalog), chosen.triggerId, value => change("triggerId", value), "発動タイミング");
    if (bCatalog.triggers.some(t => t.id === chosen.triggerId)) {
      sentence.append(el("span", "、"));
      sentenceChoice(sentence, "b-condition", getBConditionOptions(chosen.triggerId, bCatalog), chosen.conditionId, value => change("conditionId", value), "発動条件");
      const effects = getBEffectOptions(chosen.triggerId, chosen.conditionId, bCatalog);
      if (effects.length) {
        sentence.append(el("span", "、"));
        sentenceChoice(sentence, "b-effect", effects.map(d => ({ id: d.effectId, label: bEffectText(d) })), chosen.effectId, value => change("effectId", value), "効果の文章");
      }
    }
    definition = bEventEditorDefinition(chosen, bCatalog);
    statusId = chosen.options?.statusId;
    if (definition?.optionAxes.statusId) sentenceChoice(sentence, "b-status-option", bCatalog.optionSets[definition.optionAxes.statusId], statusId, value => change("statusId", value), "付与する状態");
  } else {
    definition = bCatalog.traits.find(d => d.id === b.traitId);
    const path = definition ? { category: definition.presentation.category, condition: definition.presentation.conditionLabel } : bTraitPath;
    const unique = values => [...new Set(values)].map(id => ({ id, label: id }));
    sentenceChoice(sentence, "b-category", unique(bCatalog.traits.map(d => d.presentation.category)), path.category, category => {
      bTraitPath = { category, condition: "" }; patchBattler({ bSelection: { type: "trait", traitId: "", options: {} } });
    }, "パッシブの分類");
    let rows = bCatalog.traits.filter(d => d.presentation.category === path.category);
    const conditions = unique(rows.map(d => d.presentation.conditionLabel).filter(Boolean));
    if (conditions.length) {
      sentenceChoice(sentence, "b-hp-condition", conditions, path.condition, condition => {
        bTraitPath = { category: path.category, condition }; patchBattler({ bSelection: { type: "trait", traitId: "", options: {} } });
      }, "HP条件");
      rows = rows.filter(d => d.presentation.conditionLabel === path.condition);
    }
    if (rows.length) sentenceChoice(sentence, "b-trait", rows.map(d => ({ id: d.id, label: d.presentation.effectLabel })), b.traitId,
      traitId => patchBattler({ bSelection: { type: "trait", traitId, options: {} } }), "パッシブの効果");
  }
  controls.append(sentence);
  if (definition) controls.append(el("p", bSentence(definition, statusId), "b-completed-sentence"));
}

function renderBattler() {
  const { bSelection: b, dSelection: d } = state.build.battler;
  const bBox = card("B SKILL / Bスキル", "b"), controls = el("div", null, "controls");
  const incomplete = [{ id: "incomplete", label: "未完了（選択してください）", disabled: true }];
  field(controls, "Bスキルの種類", "b-type", [{ id: "event", label: "トリガー型" }, { id: "trait", label: "パッシブ型" },
    ...(b !== null && !b.type ? incomplete : [])], b === null ? "" : b.type || "incomplete",
    type => patchBattler({ bSelection: !type ? null : type === "event"
      ? { type, triggerId: "", conditionId: "", effectId: "", options: {} } : { type, traitId: "", options: {} } }), "未設定");
  if (b?.type === "event" || b?.type === "trait") renderBSentence(controls, b);
  bBox.append(controls);
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

  const metrics = el("div", null, "metrics"); metrics.id = "stat-metrics";
  statBox.append(grid, metrics, el("p", `ATは${rules.stats.AT.min}～${rules.stats.AT.max}、DFは${rules.stats.DF.min}～${rules.stats.DF.max}。SPを含む合計上限は${rules.stats.totalMax}。HPは能力から計算します。`, "description"));
  feedback(statBox, "stats");
  const diceBox = card("DICE / ダイス", "dice"), diceGrid = el("div", null, "dice-grid"), frame = getDiceFrame(duck.diceFrame);
  const presets = Object.values(DICE_FRAMES).filter(item => item.kind === "preset");
  const type = frame?.kind === "preset" ? "preset" : duck.diceFrame;
  field(diceBox, "ダイスタイプ", "dice-type", [...Object.values(DICE_FRAMES).filter(item => item.kind === "standard").map(item => ({id:item.id,label:item.label})), {id:"preset",label:"プリセット"}], type,
    value => commit({type:"dice-type",frame:value === "preset" ? presets[0].id : value || null}), "未設定");
  if (frame?.kind === "preset") field(diceBox, "プリセット種類", "dice-preset", presets.map(item => ({id:item.id,label:item.label})), frame.id,
    value => commit({type:"dice-type",frame:value}), null);
  duck.dice.forEach((face, index) => {
    const input = select(`dice-${index}`, [0, ...(frame?.faces ?? [])].map(value => ({id:String(value),label:String(value)})), face,
      value => { const dice = [...selectedDuck(state).dice]; dice[index] = Number(value); patchDuck({dice}); }, null);
    input.disabled = !frame?.editable;
    diceGrid.append(labeled(`枠 ${index+1}`, input));
  });
  diceBox.append(diceGrid, el("p", `SP ${frame?.SP ?? "未設定"}`, "description"));
  diceBox.append(el("p", frame?.kind === "preset" ? "プリセットダイスは固定です。" : "6枠。同じ非0出目は通常2個、0を含む場合は3個まで。0は最大3個。0ごとに+1pt、0を含む3個積み1種類ごとに−1pt。", "description"));
  const diceMetrics = el("div", null, "metrics"); diceMetrics.id = "dice-metrics"; diceBox.append(diceMetrics);
  feedback(diceBox, "dice"); box.append(diceBox, statBox);
}

// A alone retains unavailable saved clauses as disabled options.
function aChoice(box, id, items, current, onChange, label, savedLabel = current, placeholder) {
  const options = [...items];
  if (current && !options.some(o => o.id === current)) options.push({ id: current, label: `現在は使用不可：${savedLabel}（再選択してください）`, disabled: true });
  const input = select(id, options, current, onChange, placeholder);
  input.setAttribute("aria-label", label); box.append(input); return input;
}
function renderA(duck, box) {
  const panel = card("A SKILL / Aスキル", "a"), a = duck.aSelection;
  field(panel, "Aスキルの設定", "a-enabled", [{ id: "on", label: "設定する" }], a === null ? "" : "on",
    value => patchDuck({ aSelection: value ? { triggerId: "", effects: [] } : null }), "未設定");
  if (a !== null) {
    const update = aSelection => patchDuck({ aSelection });
    const trigger = el("label", "発動条件");
    aChoice(trigger, "a-trigger", getATriggerOptions(duck, aCatalog).map(o => ({ ...o, label: `${aTriggerText(o.id)} / ${o.pointCost}pt` })),
      a.triggerId, triggerId => update(changeATrigger(a, triggerId, duck, aCatalog)), "発動条件", aTriggerText(a.triggerId));
    panel.append(trigger);
    const cancelled = (a.effects ?? []).some(e => isACancel(e, aCatalog));
    const cancel = el("label", "通常攻撃");
    const cancelInput = aChoice(cancel, "a-cancel", [{ id: "off", label: "キャンセルしない" },
      { id: "on", label: "キャンセルする", disabled: !aCancelAvailable(duck, a, aCatalog) }], cancelled ? "on" : "off",
      value => update(setAAttackCancel(a, value === "on", duck, aCatalog)), "通常攻撃キャンセル");
    cancelInput.children[0].disabled = true;
    panel.append(cancel);
    const resources = calculateASkillResources(duck, a, { catalog: aCatalog });
    if (cancelled) cancel.append(el("span", aCancelPointText(resources), "a-price"));
    const slots = aNormalSlots(a, aCatalog);
    slots.forEach(({ leaf, index }, slot) => {
      const chosen = aEditorLeaf(leaf, aCatalog), definitions = aEditorCatalog(duck, a, aCatalog, index);
      const allRows = aCatalog.selectionEffects.flatMap(d => d.variants);
      const row = el("div", null, "effect-row a-effect-row"), head = el("div", null, "row-heading"), controls = el("div", null, "controls");
      const change = (key, value) => update(changeAClause(a, index, key, value, duck, aCatalog));
      const formField = (key, label, options, current, savedLabel = current) => {
        const wrapper = el("label", label);
        aChoice(wrapper, key === "effectId" ? `a-effect-${slot}` : `a-effect-${slot}-${key}`, options, current,
          value => change(key, value), label, savedLabel, label);
        controls.append(wrapper);
      };
      head.append(el("strong", `効果 ${slot + 1}`), button("削除", () => update(removeANormalEffect(a, index, aCatalog))));
      const staleFace = chosen.options?.diceAction && a.triggerId !== `exact:${chosen.options.diceAction}`;
      const contents = definitions.filter(d => !(staleFace && d.id === chosen.effectId))
        .map(d => ({ id: d.id, label: d.variants[0].definition.exactFace != null ? aContentText(d.variants[0]) : d.label }));
      const saved = allRows.find(r => r.effectId === chosen.effectId && (!chosen.options?.diceAction || String(r.definition.exactFace) === chosen.options.diceAction));
      formField("effectId", "スキル効果", contents, chosen.effectId, saved ? (saved.definition.exactFace != null ? aContentText(saved) : saved.label) : chosen.effectId);
      const view = effectSelectionFields(definitions, chosen);
      const candidates = view.variants.filter(r => r.targetId === chosen.targetId && (!r.statusId || r.statusId === chosen.statusId));
      const definition = !staleFace && candidates.length === 1 ? candidates[0] : null;
      for (const key of ["targetId", "statusId", "options.amount"]) {
        const f = view.fields.find(f => f.key === key);
        const current = key === "options.amount" ? chosen.options?.amount : chosen[key];
        if (!f && !current) continue;
        const label = { targetId: "対象", statusId: "状態種別", "options.amount": "効果量" }[key];
        const options = f?.options ?? [];
        formField(key, label, key === "statusId" ? options.map(o => ({ ...o, label: aStatusText(o.id) })) : options,
          current, key === "statusId" ? aStatusText(current) : current);
      }
      const issues = [...resources.errors, ...resources.unresolved].filter(i => i.path === `effects.${index}` || i.path?.startsWith(`effects.${index}.`));
      row.append(head, controls);
      if (issues.length) row.append(el("p", "現在の設定では使用不可、または未選択です。再選択してください。", "warning"));
      if (definition && !issues.length) {
        const amount = definition.optionAxes.amount?.find(o => o.id === chosen.options?.amount)?.label ?? "";
        const target = aCatalog.targets.find(t => t.id === definition.targetId)?.label ?? "";
        const status = chosen.statusId ? `${aStatusText(chosen.statusId)}を` : "";
        const text = definition.definition.exactFace != null ? aClauseText(definition)
          : `${target}${aClauseText(definition)}${status}${amount}${aEnding(definition)}`;
        row.append(el("p", text + aDrawbackText(definition), "a-completed-sentence"));
        head.append(el("span", aEffectPointText(resources, index), "a-price"));
      }
      panel.append(row);
    });
    const add = button("＋ 効果を追加", () => update(addANormalEffect(a, aCatalog))); add.id = "a-add-effect";
    add.disabled = slots.length >= aCatalog.maxEffects; panel.append(add);
    panel.append(el("p", `通常効果は1～${aCatalog.maxEffects}個。通常攻撃キャンセルはこの枠に含みません。`, "description"));
  }
  if (a !== null) {
    const metrics = el("section", null, "a-point-breakdown"); metrics.id = "a-metrics";
    metrics.setAttribute("aria-label", "A POINT / ポイント内訳"); panel.append(metrics);
  }
  feedback(panel, "a"); box.append(panel);
}

function renderAPoints(selection, resources) {
  const box = $("a-metrics"); if (!box || selection === null) return;
  const groups = aPointSections(resources, aNormalSlots(selection, aCatalog), (selection.effects ?? []).some(e => isACancel(e, aCatalog)));
  box.replaceChildren(el("h4", "A POINT / ポイント内訳"));
  for (const group of groups) {
    const section = el("div", null, "a-point-group"), list = el("dl");
    section.append(el("h5", group.label));
    for (const row of group.rows) {
      const value = el("dd", row.text); value.id = `a-point-${row.id}`;
      if (row.id === "remaining" && resources.remaining < 0) value.className = "a-point-shortage";
      list.append(el("dt", row.label), value);
    }
    section.append(list); box.append(section);
  }
  if (resources.remaining != null && resources.remaining < 0) {
    const warning = el("p", `${Math.abs(resources.remaining)}pt不足しています`, "a-point-shortage");
    warning.id = "a-point-shortage"; box.append(warning);
  }
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
    cField(panel, "分岐方式", "c-structure", c.mode === "special" ? structures.filter(o => o.id === "flat") : structures, kind,
        value => {
          const change = () => patchDuck({ cSelection: { ...c, structure: createCStructure(value) } });
          if (hasEffects) confirmChange("分岐方式を変更すると、現在のC効果をクリアします。変更しますか？", change);
          else change();
      }, null);
    if (structure?.kind === "hpCondition") cField(panel, "自分のHP割合", "c-threshold", cCatalog.optionSets.hpThreshold,
      structure.thresholdOptionId, value => {
        const next = { ...structure }; if (value) next.thresholdOptionId = value; else delete next.thresholdOptionId;
        patchDuck({ cSelection: { ...c, structure: next } });
      });
    const branches = cBranches(c), count = branches.reduce((sum, { branch }) => sum + (branch?.effects?.length ?? 0), 0);
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
        renderEffectControls(controls,"C",chosen,replace,`c-effect-${key}-${index}`,c);
        row.append(head, controls);
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
  const isPublic = selectedPublicDuckId(state) === duck.id;
  const publicButton = button(isPublic ? "公開中" : "公開用に設定", () => commit({ type: "set-public", id: duck.id }), isPublic ? "public-active" : "");
  publicButton.disabled = isPublic || !state.publicSettings;
  if (!state.publicSettings) publicButton.title = "公開用設定を読み込めないため変更できません";
  actions.append(publicButton, button("複製", () => commit({ type: "duplicate" })), button("削除", () => {
    const current = selectedDuck(state), displayName = current.name || "名前未設定のアヒル";
    if (selectedPublicDuckId(state) === current.id) {
      showDialog({ title: "公開中のアヒルを削除", confirmLabel: "削除する", message:
        `「${displayName}」は現在、公開用アヒルに設定されています。\n\n削除すると公開用アヒルが未設定になり、他のプレイヤーから対戦相手として選択されなくなります。\n\n削除しますか？ 保存するまで確定しません。`,
      onConfirm: () => commit({ type: "delete" }) });
    } else confirmChange(`「${displayName}」を削除しますか？保存するまで確定しません。`, () => commit({ type: "delete" }));
  }, "danger"));
  meta.append(labeled("設定名", name), actions); box.append(meta);
  renderStats(duck, box); renderA(duck, box); renderC(duck, box);
}
function renderSummaries() {
  const inspection = inspectBuildForSave(state.build);
  $("save").classList.toggle("save-invalid", !inspection.canSave);
  $("save").setAttribute("aria-disabled", String(!inspection.canSave));
  $("save").title = !inspection.canSave ? "保存できない理由を表示" : inspection.complete ? "設定を保存" : "未完成の項目を確認して保存";
  for (const key of ["B", "D"]) setFeedback(key.toLowerCase(), saveSectionSummary(inspection, key));
  const duck = selectedDuck(state); if (!duck) return;
  const summary = duckSummary(duck);
  for (const key of ["stats", "dice", "A", "C"]) {
    const status = saveSectionSummary(inspection, key, duck.id);
    setFeedback(key.toLowerCase(), status);
    const metricId = key === "stats" ? "stat" : key.toLowerCase();
    $(`${metricId}-metrics`)?.classList.toggle("invalid", status.invalid.length > 0);
  }
  const frame = getDiceFrame(duck.diceFrame), budget = frame ? rules.stats.totalMax - frame.SP : null;
  const used = duck.stats.AT !== null && duck.stats.DF !== null ? duck.stats.AT + duck.stats.DF : null;
  $("stat-metrics").textContent = `AT/DF使用可能：合計${num(budget)}pt　使用中：${num(used)}pt / 残り${num(budget !== null && used !== null ? budget-used : null)}pt　HP ${num(summary.stats.hp)}`;
  const dice = summary.dice.resources;
  $("dice-metrics").textContent = `ダイス資源　獲得 ${num(dice?.earned)}pt / 消費 ${num(dice?.spent)}pt / 残り ${num(dice?.remaining)}pt`;
  renderAPoints(duck.aSelection, summary.A.resources);
  $("c-metrics").textContent = `必要AP ${num(summary.C.resources.requiredAP)}`;
}
function render() {
  const focused = document.activeElement?.id;
  renderBattler(); renderTabs(); renderDuck(); renderSummaries();
  if (focused) $(focused)?.focus({ preventScroll: true });
}
const storageMessages = {
  "migration-required": "旧保存データを安全に移行できませんでした。元データを保護し、編集・保存を停止しています。",
  corrupt: "保存データを読み込めませんでした。保存形式が壊れているため、既存データを保護して編集・保存を停止しています。",
  "unsupported-version": "このページでは対応していないバージョンの保存データです。対応するページで開いてください。",
  "storage-error": "保存領域にアクセスできませんでした。ブラウザの保存許可・空き容量などを確認してください。",
  "invalid-build": "保存できない形式が含まれています。設定内容を確認してください。",
};
$("add-duck").addEventListener("click", () => commit({ type: "add" }));
function saveSettings(approveIncomplete = false) {
  if (!state.build) return;
  const result = saveInspectedBuild(state, repository, { approveIncomplete });
  state = result.state;
  if (result.status === "invalid") {
    showDialog({ title: "保存できない設定があります", issues: result.inspection.invalid,
      message: "修正してから保存してください。", cancelLabel: "閉じる" });
  } else if (result.status === "confirmation-required") {
    showDialog({ title: "未完成の設定があります", issues: result.inspection.incomplete,
      message: "この設定は保存できますが、完成するまで戦闘には使用できません。",
      cancelLabel: "キャンセル", confirmLabel: "このまま保存", onConfirm: () => saveSettings(true) });
  } else if (result.status === "saved") {
    if (state.publicSettings) {
      const publicSaved = publicRepository.save(state.publicSettings);
      if (!publicSaved.ok) {
        state = { ...state, dirty: true };
        $("save-message").textContent = storageMessages[publicSaved.status] ?? "公開用設定を保存できませんでした。";
        return;
      }
    }
    $("save-message").textContent = "保存しました";
  }
  else $("save-message").textContent = storageMessages[result.status] ?? "保存できませんでした。";
}
$("save").addEventListener("click", () => saveSettings());
window.addEventListener("beforeunload", event => { if (state.dirty) { event.preventDefault(); event.returnValue = ""; } });
if (state.build) {
  $("editor").hidden = false; $("load-message").hidden = true; render();
  if (!state.publicSettings) {
    $("public-settings-message").hidden = false;
    $("public-settings-message").textContent = storageMessages[state.publicLoadStatus] ?? "公開用設定を読み込めませんでした。既存データを保護しています。";
  }
  if (loaded.migratedFrom) $("save-message").textContent = "v1データをv2へ移行して読み込みました。保存するまで元データは変更されません。";
} else {
  $("load-message").textContent = storageMessages[state.loadStatus] ?? "保存データを読み込めませんでした。";
  $("save").disabled = true;
}
