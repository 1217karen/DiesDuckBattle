const durations = { success: 2000, info: 2500, warning: 3000, error: 3500 };
const removalDelay = 220; // Allow the shared CSS's 200ms exit transition to finish.
let container;
const entries = [];

function removeToast(entry) {
  clearTimeout(entry.timer);
  clearTimeout(entry.removalTimer);
  entry.node.remove();
  const index = entries.indexOf(entry);
  if (index !== -1) entries.splice(index, 1);
}

export function showToast(notice) {
  if (typeof notice?.message !== "string" || !notice.message.trim()) return;
  const { message } = notice;
  const kind = Object.hasOwn(durations, notice.kind) ? notice.kind : "info";
  if (entries.some(entry => entry.kind === kind && entry.message === message)) return;
  const duration = typeof notice.duration === "number" && Number.isFinite(notice.duration) && notice.duration > 0
    ? notice.duration : durations[kind];

  if (!container) {
    container = document.createElement("div");
    container.className = "common-toast-container";
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-relevant", "additions");
    document.body.append(container);
  }
  if (entries.length === 4) removeToast(entries[0]);
  const node = document.createElement("div");
  node.className = "common-toast";
  node.dataset.kind = kind;
  node.textContent = message;
  const entry = { node, kind, message, hiding: false };
  entries.push(entry);
  container.append(node); // Normal column order places the newest toast at the bottom.
  // Leave a painted initial frame so the enter transition also runs for the first toast.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (entries.includes(entry) && !entry.hiding) node.classList.add("is-visible");
  }));
  entry.timer = setTimeout(() => {
    entry.hiding = true;
    node.classList.remove("is-visible");
    node.classList.add("is-hiding");
    entry.removalTimer = setTimeout(() => removeToast(entry), removalDelay);
  }, duration);
}
