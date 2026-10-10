import { formatCRequiredAP } from "./skillResourceDisplay.js";
import { BATTLER_PRESETS, DUCK_PRESETS, hasBattlerPresetSettings, hasDuckPresetSettings } from "./battlePresets.js";
import { inspectBattleLoadout } from "./battleLoadoutCompiler.js";
import { finishPageLoad } from "./pageLoad.js";
import { SKILL_NAME_MAX, SKILL_RUBY_MAX } from "./skillLabels.js";
import { DUCK_NAME_MAX, hasName, duckNameIssues, duckNameError, codePointLength } from "./nameValidation.js";
import { effectSelectionFields } from "./effectSelectionCatalog.js";
import { mountOnlineEditor } from "./onlineEditor.js";
import { createEmptyDuckProfile } from "./playerPresentationModel.js";
import { createSettingState, changeSetting, selectedDuck, selectedPublicDuckId, cBranches, createCStructure, duckSummary } from "./settingState.js";
import { inspectBuildForSave, saveSectionSummary } from "./buildSaveInspection.js";
import { DICE_FRAMES, getDiceFrame } from "./diceFrames.js";
import { createBuildRules } from "./buildRules.js";
import { createASkillCatalog, getATriggerOptions } from "./aSkillCatalog.js";
import { aEditorLeaf, aNormalSlots, aEditorCatalog, aCancelAvailable, isACancel, setAAttackCancel, addANormalEffect, removeANormalEffect, changeAClause, changeATrigger } from "./aSkillSentenceEditor.js";
import { aTriggerText, aTriggerEditor, aContentText, aEffectParts, aFieldOptionText, aStatusText } from "./aSkillPresentation.js";
import { calculateASkillResources } from "./aSkillResources.js";
import { createBSkillCatalog, getBTriggerOptions, getBConditionOptions, getBEffectOptions } from "./bSkillCatalog.js";
import { bEffectText, bSentence } from "./bSkillPresentation.js";
import { bEventEditorSelection, bEventEditorDefinition, changeBEvent } from "./bSkillSentenceEditor.js";
import { createCSkillCatalog } from "./cSkillCatalog.js";
import { calculateCSkillResources } from "./cSkillResources.js";
import { createCSkillRules } from "./cSkillRules.js";
import { cControlDefinitions, cControlView, changeCControl } from "./cSkillControlEditor.js";
import { cEffectParts, cFieldOptionText, C_MODE_OPTIONS, C_STRUCTURE_OPTIONS } from "./cSkillPresentation.js";
import { D_SKILL_OPTIONS } from "./dSkillCatalog.js";
import { requireLoginPage } from "./authPageGuard.js";

await requireLoginPage();

let online;
let displayPresentation;
let state = createSettingState({ ok: false, status: "loading" });
let dataVersion = 0;
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
const issueText = (section, message) => section.toLowerCase() === "a" ? message.replace("Aコストオーバー：", "Aのpt超過：") : message;
function button(text, onClick, className) {
  const node = el("button", text, className); node.type = "button"; node.addEventListener("click", onClick); return node;
}
function showDialog({ title, message, issues = [], onConfirm, confirmLabel = "変更する", cancelLabel = "取り消す" }) {
  const version = dataVersion;
  const dialog = el("dialog", null, "confirm-dialog");
  dialog.setAttribute("aria-labelledby", "confirm-heading");
  const heading = el("h3", title); heading.id = "confirm-heading";
  const actions = el("div", null, "actions");
  actions.append(button(cancelLabel, () => dialog.close()));
  if (onConfirm) actions.append(button(confirmLabel, () => {
    dialog.close(); if (version === dataVersion && online?.snapshot().canEdit) onConfirm();
  }, "primary"));
  const list = el("ul", null, "dialog-issues");
  const sections = { name: "アヒル名", stats: "ステータス", dice: "ダイス", ducks: "アヒル設定", build: "保存形式" };
  for (const issue of issues) list.append(el("li", `${issue.ownerName} / ${sections[issue.section] ?? issue.section + "スキル"}：${issueText(issue.section, issue.message)}`));
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
  const unavailable = value && (!items.some(item => String(item.id) === value && !item.disabled));
  input.className = !value || value === "incomplete" || ((id === "stat-AT" || id === "stat-DF") && value === "0")
    ? "select-empty" : unavailable ? "select-invalid" : "";
  const short = !/^(a-effect-\d+|c-effect-[\w]+-\d+)$/.test(id) && items.length && items.every(item => String(labelText(item.label)).length <= 12);
  if (short) input.className += " select-compact";
  if (unavailable && value !== "incomplete") input.setAttribute("aria-invalid", "true");
  input.addEventListener("change", () => onChange(input.value));
  return input;
}
function inputWithHint(input) {
  const hints = {
    "b-type": { event: "特定のタイミングで都度発動します。", trait: "条件を満たす限り、常に発動します。" },
    "c-mode": { normal: "自分のフェイズ開始時、APが溜まっていれば発動します。", special: "自分敗北時、APが溜まっていれば発動します。" },
    "dice-type": {
      "custom-speed": "0と1～4のみが使えるダイスです。", "custom-normal": "0と2～5のみが使えるダイスです。",
      "custom-heavy": "0と3～6のみが使えるダイスです。", "preset-standard": "1～6が1つずつ入ったダイスです。",
      "preset-void": "0のみで構成されたダイスです。"
    },
    "d-option": "戦闘開始時に1回、選んだダイスを1個追加します。",
    "a-cancel": "通常攻撃をキャンセルしても、出目効果は発動します。",
    "c-structure": "確率などで複数の効果を使い分けることができます。"
  };
  const hint = hints[input.id], text = typeof hint === "string" ? hint : hint?.[input.value];
  if (!text) return input;
  const row = el("span", null, "input-with-hint"), description = el("span", text, "description");
  description.id = input.id + "-hint"; input.setAttribute("aria-describedby", description.id);
  row.append(input, description); return row;
}
function field(box, text, id, items, current, onChange, placeholder) {
  const input = select(id, items, current, onChange, placeholder);
  box.append(text ? labeled(text, inputWithHint(input)) : inputWithHint(input));
  return input;
}
function card(title, key) {
  const box = el("section", null, ["a", "b", "c", "d"].includes(key) ? `card skill-card skill-${key}` : "card"), heading = el("div", null, "card-header");
  box.setAttribute("aria-label", title);
  const badge = el("span", null, "badge"); badge.id = `${key}-status`;
  heading.append(el("h3", title), badge); box.append(heading);
  if (["a", "b", "c", "d"].includes(key)) renderSkillLabels(box, key.toUpperCase());
  return box;
}
function renderSkillLabels(box, category) {
  const duckOwned = category === "A" || category === "C";
  const owner = duckOwned ? selectedDuck(state) : state.build.battler;
  const group = el("div", null, "skill-label-controls");
  for (const [key, text, limit] of [["name", "スキル名（任意）", SKILL_NAME_MAX], ["ruby", "ルビ（任意）", SKILL_RUBY_MAX]]) {
    const input = el("input"); input.type = "text"; input.id = `skill-${category.toLowerCase()}-${key}`;
    input.value = owner.skillLabels[category][key];
    input.placeholder = `${key === "name" ? "スキル名を入力" : "ルビを入力"}（最大${limit}文字）`;
    input.setAttribute("aria-invalid", String(codePointLength(input.value) > limit));
    input.addEventListener("input", () => {
      input.setAttribute("aria-invalid", String(codePointLength(input.value) > limit));
      const current = duckOwned ? selectedDuck(state) : state.build.battler;
      const skillLabels = { ...current.skillLabels, [category]: { ...current.skillLabels[category], [key]: input.value } };
      commit({ type: duckOwned ? "duck" : "battler", patch: { skillLabels } }, false);
    });
    group.append(labeled(text, input));
  }
  box.append(group);
}
function feedback(box, key) { const list = el("ul", null, "issues"); list.id = `${key}-issues`; box.append(list); }
function setFeedback(key, summary) {
  const badge = $(`${key}-status`); if (!badge) return;
  badge.textContent = summary.invalid.length ? summary.label : summary.incomplete.length ? "" : summary.label;
  badge.className = "badge" + (summary.invalid.length ? " invalid" : summary.incomplete.length ? " warning" : " good");
  const issues = summary.invalid.map(i => ({ ...i, severity: "invalid" }));
  const seen = new Set();
  $(`${key}-issues`)?.replaceChildren(...issues.filter(i => {
    const key = i.severity + i.message; if (seen.has(key)) return false; seen.add(key); return true;
  }).map(i => el("li", issueText(key, i.message), i.severity)));
}
function commit(action, redraw = true) {
  if (!online?.snapshot().canEdit) return;
  state = changeSetting(state, action);
  if (action.type !== "select") online.edit({ build: state.build, publicSettings: state.publicSettings });
  if (redraw) render(); else { renderTabs(); renderSummaries(); }
}
const patchDuck = (patch, redraw = true) => commit({ type: "duck", patch }, redraw);
const patchBattler = patch => commit({ type: "battler", patch });

function hasDuckDisplayData(id) {
  const display = displayPresentation?.ducks?.[id];
  if (!display) return false;
  if (Object.values(display.quotes?.skill ?? {}).some(timing => timing.lines.some(line => line.text !== "" || line.iconSlot !== null || line.opponentEno !== null))) return true;
  if (display.iconUrl || display.cutinUrl) return true;
  return Object.entries(createEmptyDuckProfile()).some(([key, empty]) =>
    JSON.stringify(display.profile?.[key] ?? empty) !== JSON.stringify(empty));
}

function deleteSelectedDuck(id) {
  if (!online?.snapshot().canEdit || selectedDuck(state)?.id !== id) return;
  const next = changeSetting(state, { type: "delete" });
  // One draft publication: build/public choice and the targeted display deletion.
  if (!online.edit({ build: next.build, publicSettings: next.publicSettings }, { deleteDuckPresentationIds: [id] })) return;
  state = next;
  displayPresentation = online.snapshot().draft.presentation;
  render();
}

// Catalog-driven normalized leaf editor: parameters stay separate from effect labels.
function cField(box, text, id, items, current, onChange, placeholder) {
  const legal = items.filter(item => !item.disabled);
  if (legal.length !== 1) { field(box, text, id, items, current, onChange, placeholder); return; }
  const only = legal[0], valid = current === only.id;
  const value = el("span", valid ? labelText(only.label)
    : `${current ? `現在は使用不可：${current}` : "未選択"}（固定値：${labelText(only.label)}）`, valid ? "c-fixed-clause" : "c-fixed-value");
  value.id = id;
  if (valid) { box.append(value); return; }
  const control = el("div", null, "c-fixed-control");
  control.append(el("span", text), value);
  if (!valid) control.append(button(`${labelText(only.label)}に設定`, () => onChange(only.id)));
  box.append(control);
}
function renderCEffect(box, chosen, replace, id, context) {
  chosen ??= { effectId: "", options: {} };
  const definitions = cControlDefinitions(cCatalog, context);
  const put = (key, value) => replace(changeCControl(chosen, key, value, cCatalog, context));
  const effectBox = el("div");
  aChoice(effectBox, id, definitions, chosen.effectId, value => put("effectId", value), "効果");
  box.append(labeled("効果：", effectBox));
  const view = cControlView(definitions, chosen), fields = [...view.fields];
  if (view.chanceEnabled || Object.hasOwn(chosen, "chanceOptionId")) fields.push({ key: "chanceOptionId", label: "成功率",
    options: view.chanceEnabled ? cCatalog.chanceOptions : [] });
  for (const key of ["targetId", "statusId", ...Object.keys(chosen.options ?? {}).map(axis => `options.${axis}`)]) {
    if (!fields.some(f => f.key === key) && (key.startsWith("options.") || Object.hasOwn(chosen, key)))
      fields.push({ key, label: "保存済みの項目", options: [] });
  }
  const sentence = el("div", null, "c-sentence-controls"); sentence.id = id + "-sentence";
  const shown = new Set();
  const renderField = key => {
    if (shown.has(key)) return;
    shown.add(key);
    const f = fields.find(f => f.key === key); if (!f) return;
    const current = key.startsWith("options.") ? chosen.options?.[key.slice(8)] : chosen[key] ?? (key === "chanceOptionId" && view.chanceEnabled ? "100" : "");
    const options = f.options.map(o => ({ ...o, label: cFieldOptionText(key, o) }));
    if (key === "options.direction" && options.length > 1) {
      const fixed = el("span", current ? `保存値：${current}（対象を選択してください）` : "増減（対象から決定）", "c-fixed-value");
      fixed.id = id + "-" + key; sentence.append(fixed);
    } else if (chosen.effectId === "grant-on-hit" && key === "targetId") {
      const valid = options.length === 1 && options[0].id === current;
      const fixed = el("span", valid ? options[0].label : current ? `現在は使用不可：${current}（状態を再選択）` : "対象（状態から決定）", valid ? "c-fixed-clause" : "c-fixed-value");
      fixed.id = id + "-" + key; sentence.append(fixed);
    } else if (options.length === 1) cField(sentence, f.label, id + "-" + key, options, current, value => put(key, value));
    else aChoice(sentence, id + "-" + key, options, current, value => put(key, value), f.label, current, f.label);
  };
  for (const part of cEffectParts(chosen.effectId, view.variants, chosen, { catalog: cCatalog, editing: true })) {
    if (typeof part === "string") sentence.append(el("span", part)); else renderField(part.key);
  }
  for (const f of fields) renderField(f.key);
  box.append(sentence);
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

function renderPresets(kind) {
  const isBattler = kind === "battler", presets = isBattler ? BATTLER_PRESETS : DUCK_PRESETS;
  const box = el("section", null, "card battle-presets"); box.id = kind + "-presets";
  const title = isBattler ? "バトラープリセット" : "アヒルプリセット";
  box.setAttribute("aria-label", title);
  const disclosure = el("details"); disclosure.id = kind + "-preset-details";
  const summary = el("summary"), heading = el("span", title + "を使用する", "preset-heading");
  heading.id = kind + "-preset-heading";
  const help = el("span", "サンプル構成を読み込んで自由に編集できます。", "description preset-help");
  help.id = kind + "-preset-help";
  summary.setAttribute("aria-labelledby", heading.id); summary.setAttribute("aria-describedby", help.id);
  summary.append(heading, help); disclosure.append(summary); box.append(disclosure);
  const description = el("p", "プリセットを選ぶと構成の説明が表示されます。", "description");
  description.id = kind + "-preset-description"; description.setAttribute("aria-live", "polite");
  const apply = button("プリセットを適用", () => {
    if (!online?.snapshot().canEdit) return;
    const preset = presets.find(p => p.id === input.value); if (!preset) return;
    const duck = selectedDuck(state);
    const action = isBattler ? { type: "battler-preset", presetId: preset.id }
      : { type: "duck-preset", presetId: preset.id, duckId: duck.id };
    const applyDraft = () => {
      if (!isBattler && selectedDuck(state)?.id !== action.duckId) return;
      commit(action);
    };
    const configured = isBattler ? hasBattlerPresetSettings(state.build.battler) : hasDuckPresetSettings(duck);
    if (configured) confirmChange(isBattler
      ? `現在のB・Dスキル設定を『${preset.label}』プリセットで置き換えます。\n保存するまでは確定されません。`
      : `現在のアヒルの戦闘設定（能力・ダイス・A・C）を『${preset.label}』プリセットで置き換えます。\nアヒル名や表示設定は変更されません。\n保存するまでは確定されません。`, applyDraft);
    else applyDraft();
  });
  apply.id = kind + "-preset-apply"; apply.disabled = true;
  const input = select(kind + "-preset", presets, "", id => {
    const preset = presets.find(p => p.id === id);
    description.textContent = preset?.description ?? "プリセットを選ぶと構成の説明が表示されます。";
    apply.disabled = !preset;
  });
  input.setAttribute("aria-describedby", description.id);
  const controls = el("div", null, "actions");
  input.setAttribute("aria-label", title); controls.append(input, apply);
  disclosure.append(controls, description); return box;
}

function renderBattler() {
  const { bSelection: b, dSelection: d } = state.build.battler;
  const bBox = card("Ｂスキル", "b"), controls = el("div", null, "controls");
  const incomplete = [{ id: "incomplete", label: "未完了（選択してください）", disabled: true }];
  field(controls, "発動タイミング", "b-type", [{ id: "event", label: "トリガー型" }, { id: "trait", label: "パッシブ型" },
    ...(b !== null && !b.type ? incomplete : [])], b === null ? "" : b.type || "incomplete",
    type => patchBattler({ bSelection: !type ? null : type === "event"
      ? { type, triggerId: "", conditionId: "", effectId: "", options: {} } : { type, traitId: "", options: {} } }), "未設定");
  if (b?.type === "event" || b?.type === "trait") renderBSentence(controls, b);
  bBox.append(controls);
  feedback(bBox, "b");
  const dBox = card("Ｄスキル", "d");
  field(dBox, null, "d-option", [...D_SKILL_OPTIONS, ...(d !== null && !d.optionId ? incomplete : [])], d === null ? "" : d.optionId || "incomplete",
    optionId => patchBattler({ dSelection: optionId ? { optionId } : null }), "未設定").setAttribute("aria-label", "Dスキル");
  feedback(dBox, "d");
  $("battler-editor").replaceChildren(renderPresets("battler"), bBox, dBox);
}

function renderTabs() {
  $("duck-tabs").replaceChildren(...state.build.ducks.map((duck, index) => {
    const tab = button(duck.name || `アヒル ${index + 1}`, () => commit({ type: "select", id: duck.id }));
    tab.id = `duck-tab-${index}`; tab.setAttribute("aria-pressed", String(duck.id === state.selectedDuckId));
    tab.setAttribute("aria-controls", "duck-editor"); return tab;
  }));
}
function renderStats(duck, box) {
  const diceBox = card("ダイス", "dice"), frame = getDiceFrame(duck.diceFrame);
  const types = Object.values(DICE_FRAMES).map(item => ({ id: item.id, label: `${item.label}（SP${item.SP}）`,
    group: item.editable ? "カスタマイズ" : "プリセット" }));
  const typeLabel = el("label", "ダイスタイプ");
  aChoice(typeLabel, "dice-type", types, duck.diceFrame, value => commit({ type: "dice-type", frame: value || null }), "ダイスタイプ", duck.diceFrame, "未設定");
  diceBox.append(typeLabel);
  if (frame) {
    const diceGrid = el("div", null, "dice-grid");
    duck.dice.forEach((face, index) => {
      const input = select(`dice-${index}`, [0, ...frame.faces].map(value => ({ id: String(value), label: String(value) })), face,
        value => { const dice = [...selectedDuck(state).dice]; dice[index] = Number(value); patchDuck({ dice }); }, null);
      input.disabled = !frame.editable;
      diceGrid.append(labeled(`枠 ${index + 1}`, input));
    });
    diceBox.append(diceGrid);
    if (!frame.editable) diceBox.append(el("p", "プリセットダイスは固定です。", "description"));
    const diceMetrics = el("div", null, "metrics"); diceMetrics.id = "dice-metrics"; diceBox.append(diceMetrics);
    const explanation = el("p", null, "description"); explanation.id = "dice-pt-description";
    explanation.append(el("span", "0を選択すると、1枠ごとに1pt獲得します。同じ出目は通常2個まで、1ptを使用すると3個まで選択可能です。"),
      el("br"), el("span", "余ったptはAスキルで使用可能です。"));
    diceBox.append(explanation);
  }
  feedback(diceBox, "dice"); box.append(diceBox);
  if (!frame) return;
  const statBox = card("ステータス", "stats"), grid = el("div", null, "stat-grid");
  for (const key of ["AT", "DF"]) {
    const other = duck.stats[key === "AT" ? "DF" : "AT"] ?? 0;
    const options = Array.from({ length: 6 }, (_, value) => {
      const shortage = value > 0 && value + other + frame.SP > rules.stats.totalMax;
      return { id: String(value), label: `${value}${shortage ? "（pt不足）" : ""}`, disabled: shortage };
    });
    const wrapper = el("label", key);
    aChoice(wrapper, `stat-${key}`, options, String(duck.stats[key] ?? 0), value => patchDuck({
      stats: { ...selectedDuck(state).stats, [key]: value === "0" ? null : Number(value) },
    }), key, duck.stats[key], null);
    grid.append(wrapper);
  }
  const spField = el("div", null, "stat-field"), spLabel = el("span", "SP"); spLabel.id = "stat-SP-label";
  spField.setAttribute("role", "group"); spField.setAttribute("aria-labelledby", spLabel.id);
  const sp = el("span", null, "stat-fixed"); sp.id = "stat-SP";
  sp.append(el("span", String(frame.SP)), el("span", "（固定）", "stat-fixed-hint"));
  spField.append(spLabel, sp); grid.append(spField);
  const metrics = el("div", null, "metrics"); metrics.id = "stat-metrics";
  statBox.append(grid, metrics, el("p", "AT・DFは1～5まで選択できます。SPを含む合計上限は9です。", "description"));
  feedback(statBox, "stats"); box.append(statBox);
}
const skillsUnlocked = duck => duck.stats.AT >= 1 && duck.stats.DF >= 1;
function aEditingSelection(duck) {
  const selection = duck.aSelection ?? { triggerId: "", effects: [] };
  return aNormalSlots(selection, aCatalog).length ? selection : addANormalEffect(selection, aCatalog);
}

// Retain unavailable saved clauses as disabled options in sentence editors.
function aChoice(box, id, items, current, onChange, label, savedLabel = current, placeholder) {
  const options = [...items];
  if (current && !options.some(o => o.id === current)) options.push({ id: current, label: `現在は使用不可：${savedLabel}（再選択してください）`, disabled: true });
  const input = select(id, options, current, onChange, placeholder);
  input.setAttribute("aria-label", label); box.append(inputWithHint(input)); return input;
}
function aSentenceChoice(box, id, items, current, onChange, label, savedLabel = current) {
  // Reading never fills a missing field or conceals an invalid saved value.
  if (items.length === 1 && items[0].id === current) {
    const fixed = el("span", items[0].label, "a-fixed-clause"); fixed.id = id;
    box.append(fixed);
  } else aChoice(box, id, items, current, onChange, label, savedLabel, label);
}
const signed = value => value == null ? "—" : value > 0 ? `+${value}` : String(value);
const negative = value => value == null ? null : -value;
function priceLabel(id, label, value, unit = "", unsigned = false) {
  const node = el("span", `${label ? label + " " : ""}${unsigned ? num(value) : signed(value)}${value == null ? "" : unit}`, "effect-price"); node.id = id; return node;
}
function settingLine(group, left, right, id) {
  const row = el("div", null, "skill-setting-line"); if (id) row.id = id;
  const meta = el("div", null, "setting-meta"), editor = el("div", null, "setting-editor");
  meta.append(left); editor.append(right); row.append(meta, editor); group.append(row); return row;
}
// Normalization may retain provisional rows for diagnostics. Never present their
// prices as confirmed, or a later slot price whose preceding choices are unsettled.
function confirmedPrices(resources, price, path, index) {
  const issues = [...resources.errors, ...resources.unresolved];
  const prefix = path.slice(0, path.lastIndexOf(".") + 1);
  const ownIssue = issues.some(i => i.path === path || i.path?.startsWith(path + "."));
  const precedingIssue = issues.some(i => i.path?.startsWith(prefix) && Number(i.path.slice(prefix.length).split(".")[0]) <= index);
  return { costKnown: !!price && !ownIssue, slotCost: precedingIssue ? null : price?.slotCost };
}
function effectMeta(index, id, label, cost, slotLabel, slotCost, remove, unit = "", unsigned = false) {
  const meta = el("div", null, "effect-meta");
  meta.append(el("strong", `効果 ${index + 1}`), priceLabel(id + "-price", label, cost, unit, unsigned),
    priceLabel(id + "-slot-price", slotLabel, slotCost, unit, unsigned), button("削除", remove));
  return meta;
}
function renderA(duck, box) {
  const panel = card("Ａスキル", "a");
  if (!skillsUnlocked(duck)) { panel.append(el("p", "ステータスを設定してください", "description")); box.append(panel); return; }
  const a = aEditingSelection(duck);
  {
    const update = aSelection => patchDuck({ aSelection });
    const resources = calculateASkillResources(duck, a, { catalog: aCatalog });
    const top = el("div", null, "skill-settings"); panel.append(top);
    settingLine(top, el("span", "使用可能pt"),
      el("span", `初期pt ${num(resources.basePoints)} ＋ ダイスpt余剰 ${num(resources.dicePoints)} ＝ ${num(resources.availablePoints)}pt`), "a-budget-line");
    const conditions = el("div", null, "effect-row a-condition-card"); conditions.id = "a-condition-card"; top.append(conditions);
    const trigger = el("div", null, "a-sentence-controls");
    const triggerView = aTriggerEditor(getATriggerOptions(duck, aCatalog), a.triggerId);
    for (const part of triggerView.parts) {
      if (typeof part === "string") trigger.append(el("span", part));
      else {
        const f = triggerView.fields.find(field => field.key === part.key);
        // Both trigger clauses remain selects; unavailable choices stay disabled.
        aChoice(trigger, f.key === "triggerId" ? "a-trigger" : "a-trigger-comparison", f.options, f.value,
          triggerId => update(changeATrigger(a, triggerId, duck, aCatalog)), f.label, aTriggerText(a.triggerId) ?? a.triggerId);
      }
    }
    const triggerEditor = el("div"); triggerEditor.append(el("span", "発動条件"), el("small", "「以下」の判定には0を含みません。", "description trigger-hint"), trigger);
    triggerEditor.append(priceLabel("a-trigger-price", "条件", negative(resources.triggerCost), "pt"));
    conditions.append(triggerEditor);
    const cancelled = (a.effects ?? []).some(e => isACancel(e, aCatalog));
    const cancel = el("label", "通常攻撃", "auxiliary-control");
    const cancelInput = aChoice(cancel, "a-cancel", [{ id: "off", label: "キャンセルしない" },
      { id: "on", label: "キャンセルする", disabled: !aCancelAvailable(duck, a, aCatalog) }], cancelled ? "on" : "off",
      value => update(setAAttackCancel(a, value === "on", duck, aCatalog)), "通常攻撃キャンセル");
    cancelInput.children[0].disabled = true;
    cancel.append(priceLabel("a-cancel-price", "還元", cancelled ? resources.cancelDrawbackPoints : 0, "pt"));
    conditions.append(cancel);
    const slots = aNormalSlots(a, aCatalog);
    slots.forEach(({ leaf, index }, slot) => {
      const chosen = aEditorLeaf(leaf, aCatalog), definitions = aEditorCatalog(duck, a, aCatalog, index);
      const allRows = aCatalog.selectionEffects.flatMap(d => d.variants);
      const row = el("div", null, "effect-row priced-effect-row a-effect-row"), editor = el("div", null, "effect-editor"), controls = el("div", null, "controls");
      const change = (key, value) => update(changeAClause(a, index, key, value, duck, aCatalog));
      const formField = (key, label, options, current, savedLabel = current) => {
        const wrapper = el("label", label);
        aChoice(wrapper, key === "effectId" ? `a-effect-${slot}` : `a-effect-${slot}-${key}`, options, current,
          value => change(key, value), label, savedLabel, label);
        controls.append(wrapper);
      };
      const price = resources.effectBreakdown.find(item => item.index === index);
      const confirmed = confirmedPrices(resources, price, `effects.${index}`, index);
      const cost = !confirmed.costKnown ? null : price?.polarity === "drawback" ? price.drawbackPoints : price?.effectCost;
      const head = effectMeta(slot, `a-effect-${slot}`, price?.polarity === "drawback" ? "還元" : "効果", cost, "枠", confirmed.slotCost,
        () => update(removeANormalEffect(a, index, aCatalog)), "pt", true);
      const staleFace = chosen.options?.diceAction && a.triggerId !== `exact:${chosen.options.diceAction}`;
      const contents = definitions.filter(d => !(staleFace && d.id === chosen.effectId))
        .map(d => ({ id: d.id, label: d.variants[0].definition.exactFace != null ? aContentText(d.variants[0]) : d.label }));
      const saved = allRows.find(r => r.effectId === chosen.effectId && (!chosen.options?.diceAction || String(r.definition.exactFace) === chosen.options.diceAction));
      formField("effectId", "スキル効果", contents, chosen.effectId, saved ? (saved.definition.exactFace != null ? aContentText(saved) : saved.label) : chosen.effectId);
      const view = effectSelectionFields(definitions, chosen);
      const sentence = el("div", null, "a-sentence-controls");
      sentence.id = `a-sentence-${slot}`;
      const parts = aEffectParts(chosen.effectId, staleFace || !view.variants.length ? (saved ? [saved] : []) : view.variants);
      const shown = new Set();
      const currentValue = key => key.startsWith("options.") ? chosen.options?.[key.slice(8)] : chosen[key];
      const showField = key => {
        shown.add(key);
        const f = view.fields.find(field => field.key === key), current = currentValue(key);
        const label = { targetId: "対象", statusId: "状態種別", "options.amount": "効果量", "options.direction": "増減" }[key] ?? f?.label ?? key;
        const options = (f?.options ?? []).map(option => ({ ...option, label: aFieldOptionText(key, option) }));
        if (key === "options.direction") {
          const valid = options.length === 1 && options[0].id === current;
          const fixed = el("span", valid ? options[0].label : "増加/減少する", "a-fixed-clause");
          fixed.id = `a-effect-${slot}-${key}`; sentence.append(fixed);
          if (current && !options.some(option => option.id === current))
            sentence.append(el("span", `現在は使用不可：${current}（対象を再選択してください）`, "warning"));
          return;
        }
        aSentenceChoice(sentence, `a-effect-${slot}-${key}`, options, current, value => change(key, value), label,
          key === "statusId" ? aStatusText(current) : current);
      };
      for (const part of parts) {
        if (typeof part === "string") sentence.append(el("span", part));
        else showField(part.key);
      }
      // Hidden identity fields (e.g. diceAction) are not prose. Still expose
      // missing/invalid visible fields so old data can be explicitly reselected.
      for (const key of ["targetId", "statusId", "options.amount", "options.direction"]) {
        if (shown.has(key)) continue;
        const f = view.fields.find(field => field.key === key), current = currentValue(key);
        if ((!f && !current) || (f?.options.length === 1 && f.options[0].id === current)) continue;
        sentence.append(el("span", `${f?.label ?? key}：`)); showField(key);
      }
      editor.append(controls, sentence); row.append(head, editor);
      panel.append(row);
    });
    const add = button("＋ 効果を追加", () => update(addANormalEffect(a, aCatalog))); add.id = "a-add-effect";
    add.disabled = slots.length >= aCatalog.maxEffects; panel.append(add);
    panel.append(el("p", "最大４枠まで効果を選択できます。", "description"));
  }
  if (a !== null) {
    const metrics = el("section", null, "resource-summary"); metrics.id = "a-metrics";
    metrics.setAttribute("aria-label", "Aスキルのpt"); panel.append(metrics);
  }
  feedback(panel, "a"); box.append(panel);
}

function renderAPoints(selection, resources) {
  const box = $("a-metrics"); if (!box || selection === null) return;
  const values = [["available", "使用可能", resources.availablePoints], ["net", "必要", resources.netCost],
    ["remaining", resources.remaining < 0 ? "pt超過" : "残り", resources.remaining == null ? null : Math.abs(resources.remaining)]];
  box.replaceChildren();
  for (const [index, [id, label, amount]] of values.entries()) {
    if (index) box.append(el("span", "｜", "muted"));
    const item = el("span");
    item.append(el("span", `${label} `));
    const value = el("span", amount == null ? "—" : `${amount}pt`); value.id = `a-point-${id}`; item.append(value);
    if (id === "remaining" && resources.remaining < 0) { item.className = "a-point-shortage"; item.id = "a-point-shortage"; }
    box.append(item);
  }
}

function renderC(duck, box) {
  // Empty rows are view-only until an explicit edit materializes that branch.
  const panel = card("Ｃスキル", "c"), c = duck.cSelection ?? { mode: "", structure: createCStructure("flat") };
  if (!skillsUnlocked(duck)) { panel.append(el("p", "ステータスを設定してください", "description")); box.append(panel); return; }
  const resources = calculateCSkillResources(c, { catalog: cCatalog, rules: cRules });
  const top = el("div", null, "skill-settings c-setting-form"), modeEditor = el("div"); top.id = "c-settings"; panel.append(top);
  top.append(modeEditor);
  const metrics = el("div", null, "resource-summary"); metrics.id = "c-metrics";
  const hasEffects = cBranches(duck.cSelection).some(({ branch }) => branch?.effects?.length);
  field(modeEditor, "発動タイミング", "c-mode", [...C_MODE_OPTIONS,
    ...(duck.cSelection !== null && !c.mode ? [{ id: "incomplete", label: "未完了（選択してください）", disabled: true }] : [])], duck.cSelection === null ? "" : c.mode || "incomplete",
    mode => {
      if (!mode) { patchDuck({ cSelection: null }); return; }
      if (duck.cSelection === null) { patchDuck({ cSelection: { mode, structure: createCStructure("flat") } }); return; }
      if (mode === "special" && c.structure?.kind !== "flat") {
        const change = () => patchDuck({ cSelection: { mode, structure: createCStructure("flat") } });
        if (hasEffects) confirmChange("特殊Cは分岐なしです。現在の分岐・効果をクリアしますか？", change);
        else change();
      } else patchDuck({ cSelection: { ...c, mode } });
    }, "未設定");
  if (c !== null) {
    const structure = c.structure;
    const kind = structure?.kind === "random" ? `random${structure.branches?.length}` : structure?.kind;
    const branchControl = el("div", null, "auxiliary-control");
    if (c.mode !== "special") top.append(branchControl);
    if (c.mode !== "special") cField(branchControl, "分岐方式", "c-structure", C_STRUCTURE_OPTIONS, kind,
        value => {
          const change = () => patchDuck({ cSelection: { ...c, structure: createCStructure(value) } });
          if (hasEffects) confirmChange("分岐方式を変更すると、現在のC効果をクリアします。変更しますか？", change);
          else change();
      }, null);
    if (structure?.kind === "hpCondition") cField(branchControl, "分岐HP割合", "c-threshold", cCatalog.optionSets.hpThreshold,
      structure.thresholdOptionId, value => {
        const next = { ...structure }; if (value) next.thresholdOptionId = value; else delete next.thresholdOptionId;
        patchDuck({ cSelection: { ...c, structure: next } });
      });
    const branches = cBranches(c), count = branches.reduce((sum, { branch }) => sum + Math.max(1, branch?.effects?.length ?? 0), 0);
    for (const { key, label, branch } of branches) {
      const branchBox = el("div", null, "branch"), effects = branch?.effects?.length ? branch.effects : [{ effectId: "", options: {} }];
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
        const row = el("div", null, "effect-row priced-effect-row"), controls = el("div", null, "effect-editor c-effect-controls");
        const path = key === "flat" ? `structure.effects.${index}` : `structure.branches.${key}.effects.${index}`;
        const price = resources.effectBreakdown.find(item => item.path === path);
        const confirmed = confirmedPrices(resources, price, path, index);
        const head = effectMeta(index, `c-effect-${key}-${index}`, "AP", confirmed.costKnown ? price.effectDelta : null, "枠AP", confirmed.slotCost,
          () => setRows(effects.filter((_, i) => i !== index)));
        const replace = value => setRows(effects.map((old, i) => i === index ? value : old));
        renderCEffect(controls,chosen,replace,`c-effect-${key}-${index}`,c);
        row.append(head, controls);
        branchBox.append(row);
      });
      const add = button("＋ C効果を追加", () => setRows([...effects, { effectId: "", options: {} }]));
      add.disabled = count >= cRules.maxEffects; branchBox.append(add); panel.append(branchBox);
    }
    panel.append(el("p", "最大５枠まで効果を選択できます。効果を分岐させた場合は、最も消費APが多い分岐が必要APに採用されます。", "description"));
  }
  panel.append(metrics); feedback(panel, "c"); box.append(panel);
}
function renderDuck() {
  const box = $("duck-editor"); box.replaceChildren(); const duck = selectedDuck(state);
  if (!duck) { box.append(el("p", "アヒル設定はまだありません。「＋ 新規アヒル」から作成できます。", "empty")); return; }
  const meta = el("div", null, "duck-meta"), name = el("input"); name.id = "duck-name"; name.value = duck.name; name.placeholder = `アヒル名を入力（最大${DUCK_NAME_MAX}文字）`; name.required = true;
  name.setAttribute("aria-invalid", String(!!duckNameError(duck.name)));
  name.addEventListener("input", () => patchDuck({ name: name.value }, false));
  const actions = el("div", null, "actions duck-actions");
  const isPublic = selectedPublicDuckId(state) === duck.id;
  const publicButton = button(isPublic ? "公開中" : "公開アヒルに設定", () => commit({ type: "set-public", id: duck.id }), isPublic ? "public-active" : "");
  publicButton.disabled = isPublic || !state.publicSettings;
  if (!state.publicSettings) publicButton.title = "公開用設定を読み込めないため変更できません";
  const deleteButton = button("削除", () => {
    if (selectedPublicDuckId(state) === selectedDuck(state)?.id) return;
    const current = selectedDuck(state), displayName = current.name || "名前未設定のアヒル";
    const displayWarning = hasDuckDisplayData(current.id)
      ? "このアヒルに登録されているアイコン・カットイン・プロフィール情報・A/Cセリフも削除されます。\n\n" : "";
    confirmChange(`「${displayName}」を削除しますか？\n\n${displayWarning}保存するまで確定しません。`, () => deleteSelectedDuck(current.id));
  }, "danger");
  deleteButton.disabled = isPublic;
  if (isPublic) deleteButton.title = "公開中のアヒルは削除できません。別のアヒルを公開アヒルに設定してください。";
  actions.append(publicButton, button("複製", () => commit({ type: "duplicate" })), deleteButton);
  const identity = el("div", null, "duck-identity");
  const iconUrl = displayPresentation?.ducks?.[duck.id]?.iconUrl;
  if (typeof iconUrl === "string" && iconUrl.trim()) {
    const iconBox = el("div", null, "duck-identity-icon"), image = el("img");
    iconBox.hidden = true; image.alt = "";
    image.addEventListener("load", () => { iconBox.hidden = false; });
    image.addEventListener("error", () => { iconBox.hidden = true; });
    image.src = iconUrl; iconBox.append(image); identity.append(iconBox);
  }
  const nameError = el("p", "", "issues"); nameError.id = "duck-name-error"; nameError.hidden = true; nameError.setAttribute("role", "status");
  name.setAttribute("aria-describedby", "duck-name-error");
  identity.append(labeled("アヒル名", name), nameError);
  meta.append(identity); box.append(actions, meta, renderPresets("duck"));
  renderStats(duck, box); renderA(duck, box); renderC(duck, box);
}
// Name requirements apply to editing/saving, not legacy loadouts or battle logic.
function inspectSettingsForSave() {
  const inspection = inspectBuildForSave(state.build);
  const invalid = [...inspection.invalid, ...duckNameIssues(state.build).filter(issue => !inspection.invalid.some(old => old.code === issue.code && old.duckId === issue.duckId))];
  if (state.build.ducks.length && !selectedPublicDuckId(state)) invalid.push({ section: "public", message: "公開アヒルを設定してください。" });
  return { ...inspection, invalid, canSave: invalid.length === 0, complete: inspection.complete && invalid.length === 0 };
}
function renderSummaries() {
  $("duck-name")?.setAttribute("aria-invalid", String(!!duckNameError(selectedDuck(state)?.name)));
  if ($("duck-name-error")) $("duck-name-error").textContent = duckNameError(selectedDuck(state)?.name);
  const inspection = inspectSettingsForSave();
  $("save").classList.toggle("save-invalid", !inspection.canSave);
  $("save").setAttribute("aria-disabled", String(!inspection.canSave));
  const publicDuckId = selectedPublicDuckId(state);
  $("save").title = !inspection.canSave ? "保存できない理由を表示"
    : publicDuckId && !inspectBattleLoadout(state.build, publicDuckId).ready ? "公開アヒルの未完成設定を確認して保存" : "設定を保存";
  for (const key of ["B", "D"]) setFeedback(key.toLowerCase(), saveSectionSummary(inspection, key));
  const duck = selectedDuck(state); if (!duck) return;
  const summary = duckSummary(duck);
  for (const key of ["stats", "dice", "A", "C"]) {
    const status = saveSectionSummary(inspection, key, duck.id);
    setFeedback(key.toLowerCase(), status);
    const metricId = key === "stats" ? "stat" : key.toLowerCase();
    $(`${metricId}-metrics`)?.classList.toggle("invalid", status.invalid.length > 0);
  }
  const frame = getDiceFrame(duck.diceFrame);
  if ($("stat-metrics")) $("stat-metrics").textContent = `ステータス合計：${(duck.stats.AT ?? 0) + (duck.stats.DF ?? 0) + (frame?.SP ?? 0)} / ${rules.stats.totalMax}　HP ${num(summary.stats.hp)}`;
  const dice = summary.dice.resources;
  if ($("dice-metrics")) $("dice-metrics").textContent = `ダイスpt　獲得 ${num(dice?.earned)}pt / 消費 ${num(dice?.spent)}pt`;
  if (skillsUnlocked(duck)) { const a = aEditingSelection(duck); renderAPoints(a, calculateASkillResources(duck, a, { catalog: aCatalog })); }
  if ($("c-metrics")) $("c-metrics").textContent = formatCRequiredAP(summary.C.resources, cRules);
}
function render() {
  if (!state.build) return;
  const focused = document.activeElement?.id;
  renderBattler(); renderTabs(); renderDuck(); renderSummaries();
  if (focused) $(focused)?.focus({ preventScroll: true });
}
$("add-duck").addEventListener("click", () => commit({ type: "add" }));
async function saveSettings(approveIncomplete = false) {
  if (!state.build || !online?.snapshot().canSave) return;
  const inspection = inspectSettingsForSave();
  if (!inspection.canSave) {
    showDialog({ title: "保存できない設定があります", issues: inspection.invalid,
      message: "修正してから保存してください。", cancelLabel: "閉じる" });
    return;
  }
  const publicDuckId = selectedPublicDuckId(state);
  if (publicDuckId && !inspectBattleLoadout(state.build, publicDuckId).ready && !approveIncomplete) {
    showDialog({ title: "公開アヒルの設定が未完成です",
      message: "このままでは対戦相手として選択されず、戦闘を行えません。\n\nこのまま保存しますか？",
      cancelLabel: "キャンセル", confirmLabel: "このまま保存", onConfirm: () => saveSettings(true) });
    return;
  }
  await online.save();
}
$("save").addEventListener("click", () => saveSettings());
online = await mountOnlineEditor({
  sections: ["build", "publicSettings"],
  allowDuckPresentationDeletion: true,
  hydrate(data) {
    dataVersion++;
    displayPresentation = data?.presentation;
    state = data ? createSettingState({ ok: true, status: "loaded", build: data.build },
      { ok: true, status: "loaded", settings: data.publicSettings }) : createSettingState({ ok: false, status: "loading" });
    bTraitPath = { category: "", condition: "" };
    if (data) render();
    else for (const id of ["battler-editor", "duck-tabs", "duck-editor"]) $(id).replaceChildren();
  },
  onState(next) { state.dirty = next.dirty; },
});

finishPageLoad();
