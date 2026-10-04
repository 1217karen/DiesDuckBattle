// The parser-time gate is shared by the entry loader and the page module.
export function finishPageLoad() { globalThis.diesDuckPageLoad?.finish(); }
