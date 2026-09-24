import { createEmptyPlayerPresentation, normalizePlayerPresentation } from "./playerPresentationModel.js";

export const PLAYER_PRESENTATION_STORAGE_KEY = "diesDuckBattle:player-presentation:v1";

export function createPlayerPresentationStorage(storage) {
  const target = () => storage ?? globalThis.localStorage;

  function load() {
    let raw;
    try { raw = target().getItem(PLAYER_PRESENTATION_STORAGE_KEY); }
    catch { return { ok: false, status: "storage-error", presentation: createEmptyPlayerPresentation() }; }
    if (raw === null) return { ok: true, status: "empty", presentation: createEmptyPlayerPresentation() };
    try {
      return { ok: true, status: "loaded", presentation: normalizePlayerPresentation(JSON.parse(raw)) };
    } catch {
      return { ok: false, status: "corrupt", presentation: createEmptyPlayerPresentation() };
    }
  }

  function save(presentation) {
    const normalized = normalizePlayerPresentation(presentation);
    try { target().setItem(PLAYER_PRESENTATION_STORAGE_KEY, JSON.stringify(normalized)); }
    catch { return { ok: false, status: "storage-error" }; }
    return { ok: true, status: "saved", presentation: normalized };
  }

  return { load, save };
}
