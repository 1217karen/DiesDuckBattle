import { createToastStore } from "./toastStore.js";
let store, returnFocus;
export function showToast(notice) {
  if (!store) {
    const root = document.createElement("aside"); root.className = "common-toast"; root.hidden = true;
    const message = document.createElement("p"); message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite"); message.setAttribute("aria-atomic", "true");
    const close = document.createElement("button"); close.type = "button"; close.textContent = "通知を閉じる";
    root.append(message, close); document.body.append(root);
    store = createToastStore({ render(value) {
      root.hidden = !value; message.textContent = value?.message ?? "";
      root.dataset.kind = value?.kind ?? "";
    } });
    close.addEventListener("click", () => {
      store.dismiss();
      const target = returnFocus?.isConnected && returnFocus.getClientRects().length ? returnFocus
        : document.querySelector("#home-status, #common-menu summary");
      target?.focus();
    });
    root.addEventListener("pointerenter", () => store.pause());
    root.addEventListener("pointerleave", () => { if (!root.contains(document.activeElement)) store.resume(); });
    root.addEventListener("focusin", () => store.pause());
    root.addEventListener("focusout", event => { if (!root.contains(event.relatedTarget)) store.resume(); });
    window.addEventListener("pagehide", () => store.destroy());
  }
  if (!document.activeElement?.closest(".common-toast")) returnFocus = document.activeElement;
  store.show(notice);
}
