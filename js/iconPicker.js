const validSlot = value => Number.isInteger(value) && value >= 1 && value <= 10 ? value : null;

export function createIconPicker({ dialog, list, closeButton }) {
  let onSelect = null;

  function close() {
    if (dialog?.open) dialog.close();
    onSelect = null;
  }

  function addChoice({ slot, url, label, disabled = false }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-choice";
    button.disabled = disabled;
    button.dataset.slot = slot === null ? "default" : String(slot);
    const image = document.createElement("img");
    image.alt = "";
    if (url.trim()) image.src = url;
    else image.hidden = true;
    image.addEventListener("error", () => { image.hidden = true; });
    const caption = document.createElement("span");
    caption.textContent = disabled ? `${label}（未登録）` : label;
    button.append(image, caption);
    button.addEventListener("click", () => { onSelect?.(slot); close(); });
    list.append(button);
  }

  function open({ defaultIconUrl = "", iconSlots = [], selectedSlot = null, select }) {
    onSelect = select;
    list.replaceChildren();
    addChoice({ slot: null, url: defaultIconUrl, label: "デフォルト" });
    for (let slot = 1; slot <= 10; slot += 1) {
      const url = typeof iconSlots[slot - 1] === "string" ? iconSlots[slot - 1] : "";
      addChoice({ slot, url, label: String(slot), disabled: !url.trim() });
    }
    const current = selectedSlot === null ? "default" : String(validSlot(selectedSlot) ?? "default");
    list.querySelector(`[data-slot="${current}"]`)?.setAttribute("aria-current", "true");
    dialog.showModal();
  }

  closeButton.addEventListener("click", close);
  dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
  return { open, close };
}
