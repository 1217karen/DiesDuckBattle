import { showToast } from "./toast.js";

export function consumeIndexNotice({ location = globalThis.location, history = globalThis.history,
  toast = showToast } = {}) {
  const url = new URL(location.href);
  if (url.searchParams.get("notice") !== "login-required") return;
  url.searchParams.delete("notice");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  toast({ kind: "error", message: "ログインしてください。" });
}
