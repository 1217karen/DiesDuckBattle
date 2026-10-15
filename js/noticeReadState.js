import { notices } from "./noticeData.js";

export const NOTICE_READ_KEY = "diesduck.notice.read-ids.v1";
export function createNoticeReadState({ articles = notices, storage = () => globalThis.localStorage } = {}) {
  const memory = new Set();
  const listeners = new Set();
  function read() {
    try {
      const value = JSON.parse(storage()?.getItem(NOTICE_READ_KEY) ?? "[]");
      if (Array.isArray(value) && value.every(id => typeof id === "string")) return new Set([...value, ...memory]);
    } catch { /* Storage may be blocked or contain malformed data. */ }
    return new Set(memory);
  }
  return {
    hasUnread() { const seen = read(); return articles.some(article => !seen.has(article.id)); },
    markRead() {
      const seen = read();
      for (const { id } of articles) { seen.add(id); memory.add(id); }
      try { storage()?.setItem(NOTICE_READ_KEY, JSON.stringify([...seen])); } catch { /* Keep this page usable. */ }
      for (const listener of listeners) listener();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}
export const noticeReadState = createNoticeReadState();
