import { PROFILE_MESSAGE_MAX, BATTLER_PROFILE_MAX, DUCK_PROFILE_MAX, profileTextError, flavorLabelError, presentationTextIssues } from "./profileTextValidation.js";
import { finishPageLoad } from "./pageLoad.js";
import { presentCSkill } from "./cSkillPresentation.js";
import { battlerNameError } from "./nameValidation.js";
import { FIXED_IMAGES, setImageFromCandidates } from "./fixedImages.js";
import { mountOnlineEditor } from "./onlineEditor.js";
import { createEmptyDuckPresentation, createEmptyDuckQuotes, quoteTimings, createEmptyDuckProfile, createEmptyPlayerPresentation, getQuoteIconUrlCandidates, presentationForPersistence, QUOTE_TEXT_MAX, isQuoteEno, createEmptyQuoteLine } from "./playerPresentationModel.js";
import { createQuoteToolbar } from "./quoteRichTextToolbar.js";
import { createIconPicker } from "./iconPicker.js";
import { createImageValidation, imageValidationSummary } from "./characterImageValidation.js";
import { requireLoginPage } from "./authPageGuard.js";

import { getSupabaseClient } from "./authRuntime.js";
import { createOnlineProfileService } from "./onlineProfileService.js";
import { createQuoteEnoLookup } from "./quoteEnoLookup.js";

await requireLoginPage();
const lookupProfile = async eno => createOnlineProfileService(await getSupabaseClient()).getProfile(eno);
const quoteLookups = new Set();

const quoteGroups = [
  { title: "戦闘開始", rows: [["戦闘開始", ["battleStart"]]] },
  { title: "ターン開始", rows: [["拮抗", ["turn", "even"]], ["優勢", ["turn", "lead"]], ["劣勢", ["turn", "behind"]]] },
  { title: "フェイズ開始", rows: [["1回目", ["phaseStart", "first"]], ["2回目", ["phaseStart", "second"]], ["3回目", ["phaseStart", "third"]]] },
  { title: "スキル発動", rows: [["B", ["skill", "B"]], ["D", ["skill", "D"]]] },
  { title: "戦闘終了", rows: [["勝利", ["battleEnd", "win"]], ["敗北", ["battleEnd", "lose"]], ["引分", ["battleEnd", "draw"]]] }
];
let online, onlineState;
let dataVersion = 0;
const picker = createIconPicker({ dialog: document.querySelector("#icon-picker"), list: document.querySelector("#picker-list"), closeButton: document.querySelector("#picker-close") });
let presentation = createEmptyPlayerPresentation();
let ducks = [];
let selectedDuckId = "";
const imageStates = new Map();
const duckEditors = new Map();
const duckQuoteRenderers = new Map();
const battlerNameInput = document.querySelector("#battler-name");
battlerNameInput.addEventListener("input", () => { online?.edit({ battlerName: battlerNameInput.value }); updateValidation(); });
const saveButton = document.querySelector("#save");
const validationMessage = document.querySelector("#image-validation-message");

function profileValidationMessage() {
  const issue = presentationTextIssues(presentation)[0];
  if (issue) return issue.duckId === null ? issue.message : (ducks.find(d => d.id === issue.duckId)?.name || "名前未設定のアヒル") + "の" + issue.message;
  for (const duck of ducks) {
    const attributes = presentation.ducks[duck.id]?.profile.attributes ?? [];
    const index = attributes.findIndex(value => [...value].length > 1);
    if (index !== -1) return `${duck.name || "名前未設定のアヒル"}の属性${index + 1}は1文字まで入力できます。`;
  }
  return "";
}

function quoteValidationMessage() {
  for (const timing of quoteTimings(presentation)) for (const line of timing.lines) {
    if ([...line.text].length > QUOTE_TEXT_MAX) return "セリフは装飾タグ込み200文字まで入力できます。";
    if (line.opponentEno !== null && !isQuoteEno(line.opponentEno)) return "ENoは先頭に0のない正整数（9223372036854775807以下）で入力してください。";
  }
  return "";
}
function updateValidation() {
  const summary = imageValidationSummary(imageStates.values());
  const nameError = battlerNameError(battlerNameInput.value);
  const validName = !nameError;
  battlerNameInput.setAttribute("aria-invalid", String(!validName));
  const profileError = profileValidationMessage() || quoteValidationMessage();
  saveButton.disabled = !validName || !summary.canSave || !!profileError || !onlineState?.canSave;
  document.querySelector("#profile-validation-message").textContent = profileError;
  validationMessage.textContent = nameError || summary.message;
}

function setDirty() { online?.edit({ presentation: presentationForPersistence(presentation) }); }
function pickerLabel(slot) {
  return slot === null ? "デフォルトアイコン" : `追加アイコン ${slot}`;
}

function makePreview(kind, onValidation, className = "", fallback = FIXED_IMAGES.battlerIcon) {
  const box = document.createElement("div"); box.className = `preview ${className}`.trim();
  let image;
  const placeholder = document.createElement("img"); placeholder.alt = "未設定画像"; if (fallback) placeholder.src = fallback;
  if (fallback) box.append(placeholder);
  const beginValidation = createImageValidation(kind, onValidation);
  const update = value => {
    const request = beginValidation(value);
    image?.remove();
    placeholder.hidden = !fallback;
    if (!value.trim()) return;
    // This is the preview itself, not a second validation-only Image request.
    const nextImage = document.createElement("img"); nextImage.alt = "画像プレビュー"; nextImage.hidden = true;
    nextImage.onload = () => {
      if (!request.active()) return;
      nextImage.hidden = false; placeholder.hidden = true;
      request.load(nextImage.naturalWidth, nextImage.naturalHeight);
    };
    nextImage.onerror = () => {
      if (!request.active()) return;
      nextImage.hidden = true; placeholder.hidden = !fallback;
      request.error();
    };
    image = nextImage; box.prepend(image); image.src = value;
  };
  return { box, update };
}

function makeImageField({ label, prefix = "", value, kind = "icon", previewClass = "", compact = false, fallback = kind === "standing" ? FIXED_IMAGES.battlerStanding : FIXED_IMAGES.battlerIcon, onInput }) {
  const version = dataVersion;
  const root = document.createElement("div"); root.className = `image-field${compact ? " compact" : ""}${kind === "cutin" ? " cutin-field" : ""}`;
const field = document.createElement("div");
field.className = "image-field-control";
const inputRow = document.createElement("div");
inputRow.className = "image-input-row";

const input = document.createElement("input");
input.type = "url";
input.value = value;
input.placeholder = "https://example.com/image.png";
input.setAttribute("aria-label", label);

if (prefix) {
  const prefixNode = document.createElement("span");
  prefixNode.className = "image-input-prefix";
  prefixNode.textContent = prefix;
  inputRow.append(prefixNode);
}

inputRow.append(input);

const status = document.createElement("span");
status.className = "image-validation";
status.setAttribute("role", "status");
  const preview = makePreview(kind, result => {
    if (version !== dataVersion) return;
    imageStates.set(root, result); root.dataset.validation = result.status;
    status.textContent = result.message; input.setAttribute("aria-invalid", String(result.status === "invalid"));
    updateValidation();
  }, previewClass, fallback);
  preview.update(value);
  input.addEventListener("input", () => { preview.update(input.value); onInput(input.value); setDirty(); });
  field.append(inputRow, status);
  if (kind === "cutin") root.append(field, preview.box); else root.append(preview.box, field);
  return root;
}

function renderBattlerImages() {
  const target = document.querySelector("#battler-images"); target.replaceChildren();
  const standingCard = document.createElement("div"); standingCard.className = "card"; standingCard.innerHTML = '<h3>立ち絵 <span class="muted">（500×800px）</span></h3>';
  standingCard.append(makeImageField({ label:"URL", value:presentation.battler.standingImageUrl, kind:"standing", previewClass:"standing", onInput:value => { presentation.battler.standingImageUrl = value; } }));
  const defaultCard = document.createElement("div"); defaultCard.className = "card"; defaultCard.innerHTML = '<h3>デフォルトアイコン <span class="muted">（120×120px）</span></h3>';
  defaultCard.append(makeImageField({ label:"URL", value:presentation.battler.defaultIconUrl, onInput:value => { presentation.battler.defaultIconUrl = value; refreshQuoteIcons(); } }));
  const slotsCard = document.createElement("div"); slotsCard.className = "card additional-icons"; slotsCard.innerHTML = '<h3>追加アイコン <span class="muted">（120×120px）</span></h3><p class="muted">セリフから参照する固定10枠です。プロフィールには最大4枠を選択できます。</p>';
  const grid = document.createElement("div"); grid.className = "icon-slots";
  const checkboxes = [];
  const syncChecks = () => {
    const selected = presentation.battler.profile.iconSlots;
    for (const [index, checkbox] of checkboxes.entries()) {
      checkbox.checked = selected.includes(index + 1);
      checkbox.disabled = !checkbox.checked && selected.length >= 4;
    }
  };
  presentation.battler.iconSlots.forEach((value, index) => {
    const slot = index + 1;
    const field = makeImageField({ label:`追加アイコン ${slot}`, prefix:String(slot), value, compact:true, onInput:next => { presentation.battler.iconSlots[index] = next; refreshQuoteIcons(); } });
    const label = document.createElement("label"); label.className = "profile-icon-choice";
    const checkbox = document.createElement("input"); checkbox.type = "checkbox";
    checkbox.setAttribute("aria-label", `追加アイコン${slot}をプロフィールに表示`);
    checkbox.addEventListener("change", () => {
      const selected = new Set(presentation.battler.profile.iconSlots);
      if (!checkbox.checked) selected.delete(slot);
      else if (selected.size < 4) selected.add(slot);
      presentation.battler.profile.iconSlots = [...selected].sort((a,b) => a-b);
      syncChecks(); setDirty();
    });
    checkboxes.push(checkbox); label.append(checkbox, document.createTextNode("プロフィールに表示"));
    field.append(label); grid.append(field);
  });
  syncChecks();
  slotsCard.append(grid); target.append(standingCard, defaultCard, slotsCard);
}

function refreshQuoteIcons() {
  document.querySelectorAll(".quote-picker").forEach(button => {
    updateQuoteIcon(button, button.quoteLine);
  });
}

function updateQuoteIcon(button, quote) {
  button.title = pickerLabel(quote.iconSlot); button.setAttribute("aria-label", button.title);
  const image = document.createElement("img"); image.alt = "";
  setImageFromCandidates(image, getQuoteIconUrlCandidates(presentation, quote), FIXED_IMAGES.battlerIcon);
  button.replaceChildren(image);
}

function renderQuotes() {
  for (const lookup of quoteLookups) lookup.dispose();
  quoteLookups.clear();
  const target = document.querySelector("#quotes"); target.replaceChildren();
  for (const group of quoteGroups) target.append(quoteGroupEditor(group, presentation.battler.quotes, "battler"));
}

function quoteGroupEditor(group, quotes, prefix, onEdit = () => {}, showTitle = true) {
    const card = document.createElement("div"); card.className = "card quote-group";
    if (showTitle) { const heading = document.createElement("h3"); heading.textContent = group.title; card.append(heading); }
    for (const [label, path] of group.rows) {
      const timing = path.reduce((value, key) => value[key], quotes);
      const block = document.createElement("div"); block.className = "quote-timing-block";
      const extras = document.createElement("div"); extras.className = "quote-extras"; extras.hidden = true;
      extras.id = "quote-extras-" + prefix + "-" + path.join("-");
      const toggle = document.createElement("button"); toggle.type = "button";
      toggle.setAttribute("aria-controls", extras.id);
      toggle.setAttribute("aria-label", group.title + " " + label + "の追加セリフ");
      const sync = () => {
        toggle.textContent = extras.hidden ? "▶" : "▼";
        toggle.className = "quote-toggle" + (timing.lines.slice(1).some(line => line.text !== "") ? " has-extras" : "");
        toggle.setAttribute("aria-expanded", String(!extras.hidden));
        block.className = "quote-timing-block" + (extras.hidden ? "" : " is-open");
      };
      const rowLookups = new Set();
      const changed = () => { onEdit(); sync(); setDirty(); updateValidation(); };
      const makeRow = (line, primary) => {
        const row = document.createElement("div"); row.className = "quote-row";
        const caption = document.createElement("span"); caption.className = "quote-label"; caption.textContent = primary ? label : "";
        const action = primary ? toggle : document.createElement("button");
        if (!primary) {
          action.type = "button"; action.className = "quote-add"; action.textContent = "＋";
          action.setAttribute("aria-label", "このセリフの直後に追加");
          action.addEventListener("click", () => { timing.lines.splice(timing.lines.indexOf(line) + 1, 0, createEmptyQuoteLine()); renderExtras(); changed(); });
        }
        const button = document.createElement("button"); button.type = "button"; button.className = "quote-picker";
        button.quoteLine = line; updateQuoteIcon(button, line);
        button.addEventListener("click", () => picker.open({ defaultIconUrl:presentation.battler.defaultIconUrl, iconSlots:presentation.battler.iconSlots, selectedSlot:line.iconSlot,
          select:slot => { line.iconSlot = slot; updateQuoteIcon(button, line); changed(); } }));
        const input = document.createElement("input"); input.type = "text"; input.value = line.text; input.placeholder = "セリフを入力";
        input.setAttribute("aria-label", group.title + " " + label + "のセリフ");
        const error = document.createElement("span"); error.className = "quote-error"; error.setAttribute("role", "status");
        const validate = () => {
          const invalid = [...line.text].length > QUOTE_TEXT_MAX;
          input.setAttribute("aria-invalid", String(invalid)); error.textContent = invalid ? "装飾タグ込み200文字まで入力できます。" : "";
        };
        const changeText = value => { line.text = value; validate(); changed(); };
        input.addEventListener("input", () => changeText(input.value));
        const editor = document.createElement("div"); editor.className = "quote-editor";
        const controls = document.createElement("div"); controls.className = "quote-controls";
        controls.append(createQuoteToolbar(input, changeText, document));
        const textRow = document.createElement("div"); textRow.className = "quote-text-row"; textRow.append(input);
        if (!primary) {
          const remove = document.createElement("button"); remove.type = "button"; remove.className = "quote-remove"; remove.textContent = "×";
          remove.setAttribute("aria-label", "この追加セリフを削除");
          remove.addEventListener("click", () => { timing.lines.splice(timing.lines.indexOf(line), 1); renderExtras(); changed(); toggle.focus(); });
          textRow.append(remove);
          const enoLabel = document.createElement("label"); enoLabel.className = "quote-eno"; enoLabel.append(document.createTextNode("ENo指定"));
          const eno = document.createElement("input"); eno.type = "text"; eno.inputMode = "numeric"; eno.value = line.opponentEno ?? "";
          eno.setAttribute("aria-label", group.title + " " + label + "の対象ENo");
          const status = document.createElement("span"); status.className = "quote-eno-status"; status.setAttribute("role", "status");
          const lookup = createQuoteEnoLookup(lookupProfile, message => { status.textContent = message; });
          quoteLookups.add(lookup); rowLookups.add(lookup);
          const updateEno = () => {
            line.opponentEno = eno.value === "" ? null : eno.value;
            eno.setAttribute("aria-invalid", String(line.opponentEno !== null && !isQuoteEno(line.opponentEno)));
            lookup.update(eno.value);
          };
          eno.addEventListener("input", () => { updateEno(); changed(); });
          updateEno(); enoLabel.append(eno); controls.append(enoLabel, status);
        }
        validate(); editor.append(textRow, controls, error); row.append(caption, action, button, editor); return row;
      };
      const renderExtras = () => {
        for (const lookup of rowLookups) { lookup.dispose(); quoteLookups.delete(lookup); }
        rowLookups.clear(); extras.replaceChildren();
        for (const line of timing.lines.slice(1)) extras.append(makeRow(line, false));
        if (timing.lines.length === 1) {
          const add = document.createElement("button"); add.type = "button"; add.textContent = "＋";
          add.setAttribute("aria-label", "追加セリフを作成");
          add.addEventListener("click", () => { timing.lines.push(createEmptyQuoteLine()); renderExtras(); changed(); });
          extras.append(add);
        }
      };
      toggle.addEventListener("click", () => {
        extras.hidden = !extras.hidden;
        if (!extras.hidden && timing.lines.length === 1) { timing.lines.push(createEmptyQuoteLine()); renderExtras(); }
        sync();
      });
      block.append(makeRow(timing.lines[0], true), extras); renderExtras(); sync(); card.append(block);
    }
    return card;
}

// Allocate only on edit: opening the page must not create absent Duck displays.
function duckPresentation(id) {
  return presentation.ducks[id] ??= createEmptyDuckPresentation();
}

function profileTextEditor(labelText, value, onChange, limit, placeholder, singleLine = false) {
  const root = document.createElement("div"); root.className = "profile-text-editor";
  const label = document.createElement("label"); label.append(document.createTextNode(labelText));
  const input = document.createElement(singleLine ? "input" : "textarea"); input.value = value;
  if (singleLine) input.type = "text"; else input.rows = 6;
  input.placeholder = placeholder;
  input.setAttribute("aria-label", labelText);
  const error = document.createElement("span"); error.className = "profile-field-error"; error.setAttribute("role", "status");
  const validate = () => {
    const message = profileTextError(input.value, limit, labelText);
    input.setAttribute("aria-invalid", String(!!message)); error.textContent = message;
  };
  const change = value => { onChange(value); validate(); setDirty(); updateValidation(); };
  validate();
  input.addEventListener("input", () => change(input.value));
  label.append(input);
  root.append(label);
  if (!singleLine) root.append(createQuoteToolbar(input, change, document, { ariaLabel: "プロフィールの文字装飾" }));
  root.append(error);
  return root;
}

function renderBattlerProfile() {
  const target = document.querySelector("#battler-profile"); target.replaceChildren();
  const heading = document.createElement("h3"); heading.textContent = "プロフィール"; target.append(heading);
  const label = document.createElement("label"), checkbox = document.createElement("input");
  label.className = "profile-streak-visibility";
  checkbox.type = "checkbox"; checkbox.checked = presentation.battler.profile.showBestStreak;
  checkbox.setAttribute("aria-label", "キャラリストに最大連勝数を表示する");
  checkbox.addEventListener("change", () => { presentation.battler.profile.showBestStreak = checkbox.checked; setDirty(); });
  label.append(checkbox, document.createTextNode("キャラリストに最大連勝数を表示する"));
  target.append(profileTextEditor("プロフィールメッセージ", presentation.battler.profile.message,
    value => { presentation.battler.profile.message = value; }, PROFILE_MESSAGE_MAX, "プロフィールメッセージを入力", true));
  const tailLabel = document.createElement("label"), tail = document.createElement("input");
  tailLabel.className = "profile-message-tail";
  tail.setAttribute("aria-label", "吹き出しとして表示する");
  tail.type = "checkbox"; tail.checked = presentation.battler.profile.messageTail;
  tail.addEventListener("change", () => { presentation.battler.profile.messageTail = tail.checked; setDirty(); updateValidation(); });
  tailLabel.append(tail, document.createTextNode("吹き出しとして表示する")); target.append(tailLabel);
  target.append(profileTextEditor("バトラープロフィール", presentation.battler.profile.text,
    value => { presentation.battler.profile.text = value; }, BATTLER_PROFILE_MAX, "バトラーのプロフィールを入力"));
  target.append(label, siteThemeSetting());
}

function siteThemeSetting() {
  const fieldset = document.createElement("fieldset"), legend = document.createElement("legend"), options = document.createElement("div");
  fieldset.className = "site-theme-setting"; legend.textContent = "サイトテーマ";
  options.className = "site-theme-options";
  for (const [value, text] of [["light", "ライト"], ["dark", "ダーク"]]) {
    const label = document.createElement("label"), radio = document.createElement("input");
    radio.type = "radio"; radio.name = "site-theme"; radio.value = value;
    radio.checked = document.documentElement.dataset.theme === value;
    radio.addEventListener("change", () => { if (radio.checked) globalThis.diesDuckSiteTheme.set(value); });
    label.append(radio, document.createTextNode(text)); options.append(label);
  }
  fieldset.append(legend, options);
  return fieldset;
}

function profileSelect(labelText, value, options, onChange) {
  const label = document.createElement("label"); label.append(document.createTextNode(labelText));
  const select = document.createElement("select"); select.setAttribute("aria-label", labelText);
  for (const [key, caption] of options) select.append(new Option(caption, key));
  select.value = value;
  select.addEventListener("change", () => { onChange(select.value); setDirty(); });
  label.append(select); return label;
}

function duckProfileEditor(duck) {
  const id = duck.id;
  const initial = presentation.ducks[id]?.profile ?? createEmptyDuckProfile();
  const profile = () => duckPresentation(id).profile;
  const root = document.createElement("section"); root.className = "duck-profile";
  const fields = document.createElement("div"); fields.className = "profile-fields";
  fields.append(profileSelect("タイプ", initial.type ?? "", [
    ["", "未設定"], ["attack", "アタック"], ["defense", "ディフェンス"], ["speed", "スピード"],
    ["heal", "ヒール"], ["technical", "テクニカル"], ["normal", "ノーマル"]
  ], value => { profile().type = value || null; }));
  const attributes = document.createElement("div"); attributes.className = "profile-attributes";
  initial.attributes.forEach((value, index) => {
    const label = document.createElement("label"); label.append(document.createTextNode(`属性${index + 1}`));
    const input = document.createElement("input"); input.type = "text"; input.value = value;
    input.setAttribute("aria-label", `属性${index + 1}`);
    const error = document.createElement("span"); error.className = "profile-field-error";
    error.id = `attribute-error-${id}-${index}`;
    input.setAttribute("aria-describedby", error.id);
    const validate = () => {
      const invalid = [...input.value].length > 1;
      input.setAttribute("aria-invalid", String(invalid));
      error.textContent = invalid ? "1文字まで入力できます。" : "";
    };
    input.addEventListener("input", () => {
      profile().attributes[index] = input.value;
      validate(); setDirty(); updateValidation();
    });
    validate(); label.append(input, error); attributes.append(label);
  });
  fields.append(attributes, profileSelect("ステータス表記", initial.statLabelPreset, [
    ["default", "AT / DF / SP"], ["kanji", "攻撃 / 防御 / 速度"],
    ["english", "Attack / Defense / Speed"], ["hiragana", "つよさ / かたさ / はやさ"]
  ], value => { profile().statLabelPreset = value; }));
  const flavor = document.createElement("div"); flavor.className = "profile-flavor";
  const rows = document.createElement("div"); rows.className = "flavor-rows";
  const add = document.createElement("button"); add.type = "button"; add.textContent = "＋ フレーバーステータス";
  const renderRows = () => {
    rows.replaceChildren();
    const stats = presentation.ducks[id]?.profile.flavorStats ?? [];
    stats.forEach((stat, index) => {
      const row = document.createElement("div"); row.className = "flavor-row";
      const label = document.createElement("label"); label.append(document.createTextNode("名前"));
      const input = document.createElement("input"); input.type = "text"; input.value = stat.label; input.placeholder = "例：食欲";
      input.setAttribute("aria-label", `フレーバーステータス${index + 1}の名前`);
      const error = document.createElement("span"); error.className = "profile-field-error"; error.setAttribute("role", "status");
      const validate = () => {
        const message = flavorLabelError(input.value);
        input.setAttribute("aria-invalid", String(!!message)); error.textContent = message;
      };
      input.addEventListener("input", () => { profile().flavorStats[index].label = input.value; validate(); setDirty(); updateValidation(); });
      validate(); label.append(input, error);
      const value = profileSelect(`フレーバーステータス${index + 1}の値`, String(stat.value),
        Array.from({ length: 7 }, (_, i) => [String(i), String(i)]), next => { profile().flavorStats[index].value = Number(next); });
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "削除";
      remove.setAttribute("aria-label", `フレーバーステータス${index + 1}を削除`);
      remove.addEventListener("click", () => {
        profile().flavorStats.splice(index, 1); renderRows(); setDirty(); updateValidation(); add.focus();
      });
      row.append(label, value, remove); rows.append(row);
    });
    add.disabled = stats.length >= 2;
  };
  add.addEventListener("click", () => {
    if (profile().flavorStats.length >= 2) return;
    profile().flavorStats.push({ label: "", value: 0 }); renderRows(); setDirty();
  });
  renderRows(); flavor.append(rows, add);
  root.append(fields, flavor, profileTextEditor("アヒルプロフィール", initial.text, value => { profile().text = value; }, DUCK_PROFILE_MAX, "アヒルのプロフィールを入力"));
  return root;
}


function renderDuckEditor() {
  const message = document.querySelector("#duck-message");
  message.textContent = selectedDuckId ? "" : "戦闘設定に保存済みのDuckがありません。";
  for (const [id, fields] of duckEditors) for (const field of fields) field.hidden = id !== selectedDuckId;
}

function renderDuckSelect() {
  const select = document.querySelector("#duck-select"); select.replaceChildren();
  // Validate every saved URL, including Ducks no longer present in the build, without deleting data.
  const known = new Set(ducks.map(duck => duck.id));
  for (const id of Object.keys(presentation.ducks)) if (!known.has(id)) ducks.push({ id, name: `${id}（戦闘設定なし）` });
  const target = document.querySelector("#duck-icon-editor"); target.replaceChildren();
  const profileTarget = document.querySelector("#duck-profile-editor"); profileTarget.replaceChildren();
  const quotesTarget = document.querySelector("#duck-quotes-editor"); quotesTarget.replaceChildren();
  duckEditors.clear(); duckQuoteRenderers.clear(); select.disabled = false;
  for (const duck of ducks) {
    const id = duck.id;
    const iconHeading = document.createElement("h3");
    iconHeading.innerHTML = 'アイコン <span class="muted">（60×60px）</span>';
    const field = makeImageField({ label:`${duck.name || "名前未設定のアヒル"} アイコンURL`, value:presentation.ducks[id]?.iconUrl ?? "", fallback:FIXED_IMAGES.duckIcon, previewClass:"duck-preview",
      onInput:value => { duckPresentation(id).iconUrl = value; } });
    const editor = document.createElement("div"); editor.className = "duck-presentation-editor";
    const cutin = document.createElement("section"); cutin.className = "duck-cutin";
    const heading = document.createElement("h3");
    heading.innerHTML = 'Cスキルカットイン <span class="muted">（480×480px）</span>';
    const description = document.createElement("p"); description.className = "muted c-skill-description";
    const skill = presentCSkill(duck.cSelection);
    description.textContent = skill.text ?? (duck.cSelection == null ? "Cスキル未設定" : "Cスキル設定未完了");
    cutin.append(heading, description, makeImageField({ label:"URL", kind:"cutin", previewClass:"cutin-preview", fallback:null,
      value:presentation.ducks[id]?.cutinUrl ?? "",
      onInput:value => { duckPresentation(id).cutinUrl = value; } }));
    const aQuotes = document.createElement("section"), cQuotes = document.createElement("section");
    const renderDuckQuotes = () => {
      const quotes = presentation.ducks[id]?.quotes ?? createEmptyDuckQuotes();
      for (const [category, root] of [["A", aQuotes], ["C", cQuotes]]) {
        const group = quoteGroupEditor(
          { title: category + "スキルセリフ", rows: [[category, ["skill", category]]] }, quotes, "duck-" + id,
          () => { duckPresentation(id).quotes = quotes; }, false);
        group.className = "quote-group";
        root.replaceChildren(group);
      }
    };
    duckQuoteRenderers.set(id, renderDuckQuotes); renderDuckQuotes();
    const profileEditor = duckProfileEditor(duck);
    const quotesEditor = document.createElement("div"); quotesEditor.className = "duck-quotes";
    editor.append(iconHeading, field);
    quotesEditor.append(aQuotes, cQuotes, cutin);
    duckEditors.set(id, [editor, profileEditor, quotesEditor]);
    target.append(editor); profileTarget.append(profileEditor); quotesTarget.append(quotesEditor);
  }
  if (!ducks.length) { const option = new Option("Duck未登録", ""); select.append(option); select.disabled = true; selectedDuckId = ""; }
  else {
    ducks.forEach(duck => select.append(new Option(duck.name.trim() || "名前未設定のアヒル", duck.id)));
    selectedDuckId = ducks.some(duck => duck.id === selectedDuckId) ? selectedDuckId : ducks[0].id;
    select.value = selectedDuckId;
  }
  select.onchange = () => { selectedDuckId = select.value; renderDuckEditor(); };
  renderDuckEditor();
}

saveButton.addEventListener("click", async () => {
  if (battlerNameError(battlerNameInput.value) || !online?.snapshot().canSave || !imageValidationSummary(imageStates.values()).canSave || profileValidationMessage() || quoteValidationMessage()) { updateValidation(); return; }
  const result = await online.save();
  if (result?.ok) { presentation = presentationForPersistence(presentation); renderQuotes(); for (const render of duckQuoteRenderers.values()) render(); updateValidation(); }
});

online = await mountOnlineEditor({
  sections: ["presentation", "battlerName"],
  hydrate(data) {
    dataVersion++;
    for (const lookup of quoteLookups) lookup.dispose();
    quoteLookups.clear();
    battlerNameInput.value = data?.battlerName ?? "";
    picker.close(); imageStates.clear(); duckEditors.clear(); duckQuoteRenderers.clear(); selectedDuckId = "";
    presentation = data ? structuredClone(data.presentation) : createEmptyPlayerPresentation();
    ducks = data ? data.build.ducks.map(({ id, name, cSelection }) => ({ id, name, cSelection })) : [];
    if (data) { renderBattlerImages(); renderBattlerProfile(); renderQuotes(); renderDuckSelect(); }
    else for (const id of ["battler-images", "battler-profile", "quotes", "duck-icon-editor", "duck-profile-editor", "duck-quotes-editor", "duck-select"]) document.getElementById(id).replaceChildren();
  },
  onState(state) { onlineState = state; battlerNameInput.disabled = !state.canEdit; if (!state.canEdit) picker.close(); updateValidation(); },
});

finishPageLoad();
