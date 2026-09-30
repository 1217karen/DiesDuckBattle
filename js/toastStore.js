/** One visible notification. Success expires; actionable errors require dismissal.
 * No persistence: navigation/reload cannot replay stale success notifications. */
export function createToastStore({ render, setTimer = setTimeout, clearTimer = clearTimeout, duration = 4000 }) {
  let current = null, pending = null, timer, generation = 0, paused = false;
  const cancel = () => { generation++; if (timer !== undefined) clearTimer(timer); timer = undefined; };
  function schedule() {
    if (current?.kind === "success" && !paused) {
      const token = generation;
      timer = setTimer(() => { if (token === generation) dismiss(); }, duration);
    }
  }
  function show(notice) {
    if (!notice || !["success", "error"].includes(notice.kind) || typeof notice.message !== "string") return;
    if (current?.kind === "error" && notice.kind === "success") { pending = notice; return; }
    if (current?.kind === notice.kind && current.message === notice.message) return;
    cancel(); current = { kind: notice.kind, message: notice.message }; render(current);
    schedule();
  }
  function dismiss() {
    cancel(); current = null; render(null);
    if (pending) { const next = pending; pending = null; show(next); }
  }
  return { show, dismiss, pause() { paused = true; cancel(); }, resume() { if (paused) { paused = false; schedule(); } }, destroy() { pending = null; paused = false; cancel(); current = null; render(null); } };
}
