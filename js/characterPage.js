import { presentCSkill } from "./cSkillPresentation.js";
import { hasName } from "./nameValidation.js";
import { FIXED_IMAGES, setImageFromCandidates } from "./fixedImages.js";
import { mountOnlineEditor } from "./onlineEditor.js";
import { createEmptyPlayerPresentation, getQuoteIconUrlCandidates } from "./playerPresentationModel.js";
import { createQuoteToolbar } from "./quoteRichTextToolbar.js";
import { createIconPicker } from "./iconPicker.js";
import { IMAGE_LIMITS, createImageValidation, imageValidationSummary } from "./characterImageValidation.js";
import { requireLoginPage } from "./authPageGuard.js";

await requireLoginPage();

const quoteGroups = [
  { title: "戦闘開始", rows: [["戦闘開始", ["battleStart"]]] },
  { title: "ターン開始", rows: [["拮抗", ["turn", "even"]], ["優勢", ["turn", "lead"]], ["劣勢", ["turn", "behind"]]] },
  { title: "フェイズ開始", rows: [["1回目", ["phaseStart", "first"]], ["2回目", ["phaseStart", "second"]], ["3回目", ["phaseStart", "third"]]] },
  { title: "スキル発動", rows: [["A", ["skill", "A"]], ["B", ["skill", "B"]], ["C", ["skill", "C"]], ["D", ["skill", "D"]]] },
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
const battlerNameInput = document.querySelector("#battler-name");
battlerNameInput.addEventListener("input", () => { online?.edit({ battlerName: battlerNameInput.value }); updateValidation(); });
const saveButton = document.querySelector("#save");
const validationMessage = document.querySelector("#image-validation-message");

function updateValidation() {
  const summary = imageValidationSummary(imageStates.values());
  const validName = hasName(battlerNameInput.value);
  battlerNameInput.setAttribute("aria-invalid", String(!validName));
  saveButton.disabled = !validName || !summary.canSave || !onlineState?.canSave;
  validationMessage.textContent = validName ? summary.message : "バトラー名を入力してください（空白のみは使用できません）。";
}

function setDirty() { online?.edit({ presentation }); }
function quoteAt(path) { return path.reduce((value, key) => value[key], presentation.battler.quotes); }
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

function makeImageField({ label, value, kind = "icon", previewClass = "", compact = false, fallback = kind === "standing" ? FIXED_IMAGES.battlerStanding : FIXED_IMAGES.battlerIcon, onInput }) {
  const version = dataVersion;
  const root = document.createElement("div"); root.className = `image-field${compact ? " compact" : ""}${kind === "cutin" ? " cutin-field" : ""}`;
  const field = document.createElement("label"); field.append(document.createTextNode(label));
  const input = document.createElement("input"); input.type = "url"; input.value = value; input.placeholder = "https://example.com/image.png";
  const limit = IMAGE_LIMITS[kind];
  const hint = document.createElement("span"); hint.textContent = `最大${limit.width}×${limit.height}px（縦横比自由）`;
  const status = document.createElement("span"); status.className = "image-validation"; status.setAttribute("role", "status");
  const preview = makePreview(kind, result => {
    if (version !== dataVersion) return;
    imageStates.set(root, result); root.dataset.validation = result.status;
    status.textContent = result.message; input.setAttribute("aria-invalid", String(result.status === "invalid"));
    updateValidation();
  }, previewClass, fallback);
  preview.update(value);
  input.addEventListener("input", () => { preview.update(input.value); onInput(input.value); setDirty(); });
  field.append(hint, input, status);
  if (kind === "cutin") root.append(field, preview.box); else root.append(preview.box, field);
  return root;
}

function renderBattlerImages() {
  const target = document.querySelector("#battler-images"); target.replaceChildren();
  const standingCard = document.createElement("div"); standingCard.className = "card"; standingCard.innerHTML = "<h3>立ち絵</h3>";
  standingCard.append(makeImageField({ label:"URL", value:presentation.battler.standingImageUrl, kind:"standing", previewClass:"standing", onInput:value => { presentation.battler.standingImageUrl = value; } }));
  const defaultCard = document.createElement("div"); defaultCard.className = "card"; defaultCard.innerHTML = "<h3>デフォルトアイコン</h3>";
  defaultCard.append(makeImageField({ label:"URL", value:presentation.battler.defaultIconUrl, onInput:value => { presentation.battler.defaultIconUrl = value; refreshQuoteIcons(); } }));
  const slotsCard = document.createElement("div"); slotsCard.className = "card additional-icons"; slotsCard.innerHTML = "<h3>追加アイコン</h3><p class=\"muted\">セリフから参照する固定10枠です。</p>";
  const grid = document.createElement("div"); grid.className = "icon-slots";
  presentation.battler.iconSlots.forEach((value, index) => grid.append(makeImageField({ label:`${index + 1} URL`, value, compact:true, onInput:next => { presentation.battler.iconSlots[index] = next; refreshQuoteIcons(); } })));
  slotsCard.append(grid); target.append(standingCard, defaultCard, slotsCard);
}

function refreshQuoteIcons() {
  document.querySelectorAll(".quote-picker").forEach(button => {
    updateQuoteIcon(button, button.dataset.path.split("."));
  });
}

function updateQuoteIcon(button, path) {
  const quote = quoteAt(path);
  button.title = pickerLabel(quote.iconSlot); button.setAttribute("aria-label", button.title);
  const image = document.createElement("img"); image.alt = "";
  setImageFromCandidates(image, getQuoteIconUrlCandidates(presentation, quote), FIXED_IMAGES.battlerIcon);
  button.replaceChildren(image);
}

function renderQuotes() {
  const target = document.querySelector("#quotes"); target.replaceChildren();
  for (const group of quoteGroups) {
    const card = document.createElement("div"); card.className = "card quote-group";
    const heading = document.createElement("h3"); heading.textContent = group.title; card.append(heading);
    for (const [label, path] of group.rows) {
      const initialValue = quoteAt(path);
      const row = document.createElement("div"); row.className = "quote-row";
      const caption = document.createElement("span"); caption.className = "quote-label"; caption.textContent = label;
      const button = document.createElement("button"); button.type = "button"; button.className = "quote-picker"; button.dataset.path = path.join("."); updateQuoteIcon(button, path);
      button.addEventListener("click", () => picker.open({ defaultIconUrl:presentation.battler.defaultIconUrl, iconSlots:presentation.battler.iconSlots, selectedSlot:quoteAt(path).iconSlot, select:slot => { quoteAt(path).iconSlot = slot; updateQuoteIcon(button, path); setDirty(); } }));
      const input = document.createElement("input"); input.type = "text"; input.value = initialValue.text; input.placeholder = "セリフを入力"; input.setAttribute("aria-label", `${group.title} ${label}のセリフ`);
      const changeText = value => { quoteAt(path).text = value; setDirty(); };
      input.addEventListener("input", () => changeText(input.value));
      const editor = document.createElement("div"); editor.className = "quote-editor";
      editor.append(input, createQuoteToolbar(input, changeText, document));
      row.append(caption, button, editor); card.append(row);
    }
    target.append(card);
  }
}

function renderDuckEditor() {
  const message = document.querySelector("#duck-message");
  message.textContent = selectedDuckId ? "" : "戦闘設定に保存済みのDuckがありません。";
  for (const [id, field] of duckEditors) field.hidden = id !== selectedDuckId;
}

function renderDuckSelect() {
  const select = document.querySelector("#duck-select"); select.replaceChildren();
  // Validate every saved URL, including Ducks no longer present in the build, without deleting data.
  const known = new Set(ducks.map(duck => duck.id));
  for (const id of Object.keys(presentation.ducks)) if (!known.has(id)) ducks.push({ id, name: `${id}（戦闘設定なし）` });
  const target = document.querySelector("#duck-icon-editor"); target.replaceChildren();
  duckEditors.clear(); select.disabled = false;
  for (const duck of ducks) {
    const id = duck.id;
    const field = makeImageField({ label:`${duck.name || "名前未設定のDuck"} アイコンURL`, value:presentation.ducks[id]?.iconUrl ?? "", fallback:FIXED_IMAGES.duckIcon, previewClass:"duck-preview",
      onInput:value => { presentation.ducks[id] = { ...(presentation.ducks[id] ?? {}), iconUrl:value }; } });
    const editor = document.createElement("div"); editor.className = "duck-presentation-editor";
    const cutin = document.createElement("section"); cutin.className = "duck-cutin";
    const heading = document.createElement("h3"); heading.textContent = "Cスキルカットイン";
    const description = document.createElement("p"); description.className = "muted c-skill-description";
    const skill = presentCSkill(duck.cSelection);
    description.textContent = skill.text ?? (duck.cSelection == null ? "Cスキル未設定" : "Cスキル設定未完了");
    cutin.append(heading, description, makeImageField({ label:"URL", kind:"cutin", previewClass:"cutin-preview", fallback:null,
      value:presentation.ducks[id]?.cutinUrl ?? "",
      onInput:value => { presentation.ducks[id] = { ...(presentation.ducks[id] ?? {}), cutinUrl:value }; } }));
    editor.append(field, cutin); duckEditors.set(id, editor); target.append(editor);
  }
  if (!ducks.length) { const option = new Option("Duck未登録", ""); select.append(option); select.disabled = true; selectedDuckId = ""; }
  else {
    ducks.forEach(duck => select.append(new Option(duck.name.trim() || "名前未設定のDuck", duck.id)));
    selectedDuckId = ducks.some(duck => duck.id === selectedDuckId) ? selectedDuckId : ducks[0].id;
    select.value = selectedDuckId;
  }
  select.onchange = () => { selectedDuckId = select.value; renderDuckEditor(); };
  renderDuckEditor();
}

saveButton.addEventListener("click", async () => {
  if (!hasName(battlerNameInput.value) || !online?.snapshot().canSave || !imageValidationSummary(imageStates.values()).canSave) { updateValidation(); return; }
  await online.save();
});

online = await mountOnlineEditor({
  sections: ["presentation", "battlerName"],
  hydrate(data) {
    dataVersion++;
    battlerNameInput.value = data?.battlerName ?? "";
    picker.close(); imageStates.clear(); duckEditors.clear(); selectedDuckId = "";
    presentation = data ? structuredClone(data.presentation) : createEmptyPlayerPresentation();
    ducks = data ? data.build.ducks.map(({ id, name, cSelection }) => ({ id, name, cSelection })) : [];
    if (data) { renderBattlerImages(); renderQuotes(); renderDuckSelect(); }
    else for (const id of ["battler-images", "quotes", "duck-icon-editor", "duck-select"]) document.getElementById(id).replaceChildren();
  },
  onState(state) { onlineState = state; battlerNameInput.disabled = !state.canEdit; if (!state.canEdit) picker.close(); updateValidation(); },
});
