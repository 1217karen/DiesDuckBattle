import { isQuoteEno } from "./playerPresentationModel.js";

/** A per-row debounce; changing input or disposing invalidates every pending response. */
export function createQuoteEnoLookup(getProfile, display, { delay = 400, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let timer, version = 0;
  return {
    update(value) {
      cancel(timer); const request = ++version;
      display(value !== "" && !isQuoteEno(value) ? "ENoの形式が不正です。" : "");
      if (!isQuoteEno(value)) return;
      timer = schedule(async () => {
        try {
          const result = await getProfile(value);
          if (request !== version) return;
          display(result.ok ? `ENo.${value} ${result.profile.battler.name}` :
            result.status === "profile-not-found" ? `ENo.${value} 該当なし` : "確認できません");
        } catch { if (request === version) display("確認できません"); }
      }, delay);
    },
    dispose() { cancel(timer); version++; },
  };
}
