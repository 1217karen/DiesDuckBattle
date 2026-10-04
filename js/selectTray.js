import { FIXED_IMAGES, setImageWithFallback } from "./fixedImages.js";

/** Display-only cards. Selection and readiness remain owned by the SELECT controller. */
export function renderChoices(grid, choices, selected, onPick, { kind, presentation } = {}) {
  const document = grid.ownerDocument;
  grid.replaceChildren();
  for (const choice of choices) {
    const opponent = kind === "opponents";
    const card = document.createElement("article"); card.className = "trayItem";
    const button = document.createElement("button"); button.type = "button";
    button.disabled = !choice.ready;
    button.setAttribute("aria-pressed", String(selected === choice.id));
    button.setAttribute("aria-label", opponent ? `ENo.${choice.eno} ${choice.name} を選択` : `アヒル「${choice.name}」を選択`);
    const icon = document.createElement("img"); icon.className = "trayItem__img"; icon.alt = "";
    setImageWithFallback(icon, opponent ? choice.defaultIconUrl : presentation?.ducks?.[choice.id]?.iconUrl,
      opponent ? FIXED_IMAGES.battlerIcon : FIXED_IMAGES.duckIcon);
    button.append(icon);
    if (opponent) {
      const eno = document.createElement("span"); eno.className = "trayItem__eno";
      eno.textContent = `ENo.${choice.eno}`; button.append(eno);
    }
    const name = document.createElement("span"); name.className = "trayItem__name";
    name.textContent = choice.name; button.append(name); card.append(button);
    if (choice.reasons.length) {
      const details = document.createElement("details"), summary = document.createElement("summary");
      summary.textContent = "理由を確認"; details.append(summary);
      const list = document.createElement("ul");
      for (const reason of choice.reasons) { const li = document.createElement("li"); li.textContent = reason; list.append(li); }
      details.append(list); card.append(details);
    }
    button.addEventListener("click", () => onPick(choice.id)); grid.append(card);
  }
}
