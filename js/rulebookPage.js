import { finishPageLoad } from "./pageLoad.js";
import { mountDocumentTabs } from "./documentTabs.js";

export function mountRulebook({ document = globalThis.document, window = globalThis.window, finish = finishPageLoad } = {}) {
  mountDocumentTabs({ names: ["guide", "battle", "guidelines"], document, window });
  finish();
}

if (typeof document !== "undefined") mountRulebook();
