
import { FIXED_IMAGES, setImageWithFallback } from "./fixedImages.js";
import { CHARACTER_TYPES } from "./onlineCharacterListService.js";

export function createCharacterCard(document, character) {
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  const card = el("a", undefined, "character-card");
  card.href = `profile.html?eno=${character.eno}`;
  card.style.borderColor = character.accent;

  // バトラーの証明写真
  const battler = el("img", undefined, "character-battler-icon");
  battler.alt = "";
  battler.width = 120;
  battler.height = 120;
  setImageWithFallback(
    battler,
    character.battlerIconUrl,
    FIXED_IMAGES.battlerIcon
  );

  // 登録情報
  const details = el("div", undefined, "character-card-details");
  const eno = el("span", `ENo.${character.eno}`, "character-eno");
  const name = el("h2", character.battlerName, "character-name");

  // パートナーアヒル
  const duck = character.duck;
  const duckRow = el("div", undefined, "character-duck");

  const duckIcon = el("img", undefined, "character-duck-icon");
  duckIcon.alt = "";
  duckIcon.width = 60;
  duckIcon.height = 60;
  setImageWithFallback(
    duckIcon,
    duck?.iconUrl,
    FIXED_IMAGES.duckIcon
  );

  const duckInfo = el("div", undefined, "character-duck-info");
  const duckName = el(
    "div",
    duck?.name ?? "―",
    "character-duck-name"
  );

  const meta = el("div", undefined, "character-duck-meta");
  const type = duck?.type
    ? `${CHARACTER_TYPES[duck.type]}タイプ`
    : "―";
  const attributes = duck?.attributes.filter(Boolean).join("・") || "―";

  meta.append(
    el("span", type),
    el("span", `属性：${attributes}`)
  );

  duckInfo.append(duckName, meta);
  duckRow.append(duckIcon, duckInfo);

  // 最大連勝数
  const streak = el(
    "div",
    undefined,
    "character-streak"
  );
  streak.append(
    el("span", "MAX STREAK", "character-streak-label"),
    el("span", String(character.bestStreak ?? "―"), "character-streak-number")
  );

  details.append(eno, name, duckRow, streak);
  card.append(battler, details);

  return card;
}
