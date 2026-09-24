import { createPlayerBuildStorage } from "./playerBuildStorage.js";
import { createEmptyPlayerPresentation, normalizePlayerPresentation } from "./playerPresentationModel.js";
import { createPlayerPresentationStorage } from "./playerPresentationStorage.js";
import { createIconPicker } from "./iconPicker.js";
import { IMAGE_LIMITS, createImageValidation, imageValidationSummary } from "./characterImageValidation.js";

const quoteGroups = [
  { title: "戦闘開始", rows: [["戦闘開始", ["battleStart"]]] },
  { title: "ターン開始", rows: [["拮抗", ["turn", "even"]], ["優勢", ["turn", "lead"]], ["劣勢", ["turn", "behind"]]] },
  { title: "フェイズ開始", rows: [["1回目", ["phaseStart", "first"]], ["2回目", ["phaseStart", "second"]], ["3回目", ["phaseStart", "third"]]] },
  { title: "スキル発動", rows: [["A", ["skill", "A"]], ["B", ["skill", "B"]], ["C", ["skill", "C"]], ["D", ["skill", "D"]]] },
  { title: "戦闘終了", rows: [["勝利", ["battleEnd", "win"]], ["敗北", ["battleEnd", "lose"]], ["引分", ["battleEnd", "draw"]]] }
];
const editor = document.querySelector("#editor");
const loadMessage = document.querySelector("#load-message");
const saveMessage = document.querySelector("#save-message");
const presentationStorage = createPlayerPresentationStorage();
const picker = createIconPicker({ dialog: document.querySelector("#icon-picker"), list: document.querySelector("#picker-list"), closeButton: document.querySelector("#picker-close") });
let presentation = createEmptyPlayerPresentation();
let ducks = [];
let selectedDuckId = "";
const imageStates = new Map();
const duckEditors = new Map();
const saveButton = document.querySelector("#save");
const validationMessage = document.querySelector("#image-validation-message");

function updateValidation() {
  const summary = imageValidationSummary(imageStates.values());
  saveButton.disabled = !summary.canSave;
  validationMessage.textContent = summary.message;
}

function setDirty() { saveMessage.textContent = "未保存の変更があります"; }
function quoteAt(path) { return path.reduce((value, key) => value[key], presentation.battler.quotes); }
function pickerLabel(slot) {
  if (slot === null) return "デフォルト";
  return presentation.battler.iconSlots[slot - 1]?.trim() ? `追加 ${slot}` : `追加 ${slot}（未登録）`;
}

function makePreview(kind, onValidation, className = "") {
  const box = document.createElement("div"); box.className = `preview ${className}`.trim();
  let image;
  const placeholder = document.createElement("span"); placeholder.textContent = "NO IMAGE";
  box.append(placeholder);
  const beginValidation = createImageValidation(kind, onValidation);
  const update = value => {
    const request = beginValidation(value);
    image?.remove();
    placeholder.hidden = false; placeholder.textContent = value.trim() ? "読込中…" : "NO IMAGE";
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
      nextImage.hidden = true; placeholder.hidden = false; placeholder.textContent = "プレビュー不可";
      request.error();
    };
    image = nextImage; box.prepend(image); image.src = value;
  };
  return { box, update };
}

function makeImageField({ label, value, kind = "icon", previewClass = "", compact = false, onInput }) {
  const root = document.createElement("div"); root.className = `image-field${compact ? " compact" : ""}`;
  const field = document.createElement("label"); field.append(document.createTextNode(label));
  const input = document.createElement("input"); input.type = "url"; input.value = value; input.placeholder = "https://example.com/image.png";
  const limit = IMAGE_LIMITS[kind];
  const hint = document.createElement("span"); hint.textContent = `最大${limit.width}×${limit.height}px（縦横比自由）`;
  const status = document.createElement("span"); status.className = "image-validation"; status.setAttribute("role", "status");
  const preview = makePreview(kind, result => {
    imageStates.set(root, result); root.dataset.validation = result.status;
    status.textContent = result.message; input.setAttribute("aria-invalid", String(result.status === "invalid"));
    updateValidation();
  }, previewClass);
  preview.update(value);
  input.addEventListener("input", () => { preview.update(input.value); onInput(input.value); setDirty(); });
  field.append(hint, input, status); root.append(preview.box, field); return root;
}

function renderBattlerImages() {
  const target = document.querySelector("#battler-images"); target.replaceChildren();
  const standingCard = document.createElement("div"); standingCard.className = "card"; standingCard.innerHTML = "<h3>立ち絵</h3>";
  standingCard.append(makeImageField({ label:"URL", value:presentation.battler.standingImageUrl, kind:"standing", previewClass:"standing", onInput:value => { presentation.battler.standingImageUrl = value; } }));
  const defaultCard = document.createElement("div"); defaultCard.className = "card"; defaultCard.innerHTML = "<h3>デフォルトアイコン</h3>";
  defaultCard.append(makeImageField({ label:"URL", value:presentation.battler.defaultIconUrl, onInput:value => { presentation.battler.defaultIconUrl = value; refreshPickerLabels(); } }));
  const slotsCard = document.createElement("div"); slotsCard.className = "card additional-icons"; slotsCard.innerHTML = "<h3>追加アイコン</h3><p class=\"muted\">セリフから参照する固定10枠です。</p>";
  const grid = document.createElement("div"); grid.className = "icon-slots";
  presentation.battler.iconSlots.forEach((value, index) => grid.append(makeImageField({ label:`${index + 1} URL`, value, compact:true, onInput:next => { presentation.battler.iconSlots[index] = next; refreshPickerLabels(); } })));
  slotsCard.append(grid); target.append(standingCard, defaultCard, slotsCard);
}

function refreshPickerLabels() {
  document.querySelectorAll(".quote-picker").forEach(button => {
    const path = button.dataset.path.split("."); button.textContent = pickerLabel(quoteAt(path).iconSlot);
  });
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
      const button = document.createElement("button"); button.type = "button"; button.className = "quote-picker"; button.dataset.path = path.join("."); button.textContent = pickerLabel(initialValue.iconSlot);
      button.addEventListener("click", () => picker.open({ defaultIconUrl:presentation.battler.defaultIconUrl, iconSlots:presentation.battler.iconSlots, selectedSlot:quoteAt(path).iconSlot, select:slot => { quoteAt(path).iconSlot = slot; button.textContent = pickerLabel(slot); setDirty(); } }));
      const input = document.createElement("textarea"); input.value = initialValue.text; input.placeholder = "セリフを入力"; input.setAttribute("aria-label", `${group.title} ${label}のセリフ`);
      input.addEventListener("input", () => { quoteAt(path).text = input.value; setDirty(); });
      row.append(caption, button, input); card.append(row);
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
  const target = document.querySelector("#duck-icon-editor");
  for (const duck of ducks) {
    const id = duck.id;
    const field = makeImageField({ label:`${duck.name || "名前未設定のDuck"} アイコンURL`, value:presentation.ducks[id]?.iconUrl ?? "",
      onInput:value => { presentation.ducks[id] = { iconUrl:value }; } });
    duckEditors.set(id, field); target.append(field);
  }
  if (!ducks.length) { const option = new Option("Duck未登録", ""); select.append(option); select.disabled = true; selectedDuckId = ""; }
  else {
    ducks.forEach(duck => select.append(new Option(duck.name.trim() || "名前未設定のDuck", duck.id)));
    selectedDuckId = ducks.some(duck => duck.id === selectedDuckId) ? selectedDuckId : ducks[0].id;
    select.value = selectedDuckId;
  }
  select.addEventListener("change", () => { selectedDuckId = select.value; renderDuckEditor(); });
  renderDuckEditor();
}

function initialize() {
  const loaded = presentationStorage.load();
  presentation = normalizePlayerPresentation(loaded.presentation);
  const buildLoaded = createPlayerBuildStorage().load();
  ducks = buildLoaded.ok && Array.isArray(buildLoaded.build?.ducks) ? buildLoaded.build.ducks.map(({ id, name }) => ({ id, name })) : [];
  renderBattlerImages(); renderQuotes(); renderDuckSelect();
  loadMessage.textContent = loaded.ok ? (loaded.status === "empty" ? "未保存の表示設定です。" : "表示設定を読み込みました。")
    : loaded.status === "corrupt" ? "保存データを読み取れなかったため、初期値で開きました。保存すると修復されます。" : "保存領域を利用できません。入力内容は保存できない可能性があります。";
  editor.hidden = false;
}

document.querySelector("#save").addEventListener("click", () => {
  if (!imageValidationSummary(imageStates.values()).canSave) { updateValidation(); return; }
  const saved = presentationStorage.save(presentation);
  if (!saved.ok) { saveMessage.textContent = "保存できませんでした。ブラウザの保存設定を確認してください。"; return; }
  presentation = saved.presentation; saveMessage.textContent = "表示設定を保存しました";
});

initialize();
