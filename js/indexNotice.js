import { showToast } from "./toast.js";

const notices = {
  "login-required": { kind: "error", message: "ログインしてください。" },
  "logged-out": { kind: "success", message: "ログアウトしました。" },
};

export function consumeIndexNotice({ location = globalThis.location, history = globalThis.history,
  toast = showToast } = {}) {
  const url = new URL(location.href);
  const code = url.searchParams.get("notice");
  if (!Object.hasOwn(notices, code)) return;
  url.searchParams.delete("notice");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  toast({ ...notices[code] });
}
