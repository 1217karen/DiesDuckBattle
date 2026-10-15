import { noticeReadState, NOTICE_READ_KEY } from "./noticeReadState.js";

export function mountNoticeIndicators(document, window, state = noticeReadState) {
  function refresh() {
    const unread = state.hasUnread();
    for (const link of document.querySelectorAll('a[href="notice.html"]')) {
      link.setAttribute("data-notice-unread", String(unread));
      link.setAttribute("aria-label", unread ? "お知らせ（未読のお知らせがあります）" : "お知らせ");
    }
  }
  const unsubscribe = state.subscribe(refresh);
  const storageChanged = event => { if (event.key === NOTICE_READ_KEY || event.key === null) refresh(); };
  window.addEventListener("storage", storageChanged);
  window.addEventListener("pageshow", refresh);
  document.addEventListener("visibilitychange", refresh);
  // Only link replacement is observed; updating attributes cannot trigger a loop.
  const observer = new window.MutationObserver(refresh);
  const menu = document.getElementById("common-menu");
  if (menu) observer.observe(menu, { childList: true, subtree: true });
  refresh();
  return () => {
    unsubscribe(); observer.disconnect();
    window.removeEventListener("storage", storageChanged);
    window.removeEventListener("pageshow", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}
if (typeof document !== "undefined" && typeof window !== "undefined") mountNoticeIndicators(document, window);
