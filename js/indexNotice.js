import { showToast } from "./toast.js";
import { canonicalEno } from "../supabase/functions/_shared/internal-email.mjs";

const notices = {
  "login-required": { kind: "error", message: "ログインしてください。" },
  "logged-out": { kind: "success", message: "ログアウトしました。" },
};

export function consumeIndexNotice({ location = globalThis.location, history = globalThis.history,
  toast = showToast } = {}) {
  const url = new URL(location.href);
  const code = url.searchParams.get("notice");
  let notice;
  if (code === "registered") {
    try { notice = { kind: "success", message: `新規登録しました。あなたはENo.${canonicalEno(url.searchParams.get("eno"))}です。` }; }
    catch { /* Consume invalid registration notices without displaying an ENo. */ }
    url.searchParams.delete("eno");
  } else if (Object.hasOwn(notices, code)) notice = notices[code];
  else return;
  url.searchParams.delete("notice");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  if (notice) toast({ ...notice });
}
