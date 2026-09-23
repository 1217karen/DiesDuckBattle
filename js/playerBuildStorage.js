import { PLAYER_BUILD_SCHEMA_VERSION, createEmptyPlayerBuild, clonePlayerBuild } from "./playerBuildModel.js";

export const PLAYER_BUILD_STORAGE_KEY = "diesDuckBattle:player-build:v1";

/** Lazy browser access; inject a Storage-compatible object in Node or other hosts. */
export function createPlayerBuildStorage(storage) {
  const target = () => storage ?? globalThis.localStorage;
  function load() {
    let raw;
    try { raw = target().getItem(PLAYER_BUILD_STORAGE_KEY); }
    catch { return { ok: false, status: "storage-error", build: null }; }
    if (raw === null) return { ok: true, status: "empty", build: createEmptyPlayerBuild() };
    let value;
    try { value = JSON.parse(raw); }
    catch { return { ok: false, status: "corrupt", build: null }; }
    if (value && typeof value === "object" && Number.isInteger(value.schemaVersion)
      && value.schemaVersion > 0 && value.schemaVersion !== PLAYER_BUILD_SCHEMA_VERSION) {
      return { ok: false, status: "unsupported-version", schemaVersion: value.schemaVersion, build: null };
    }
    try { return { ok: true, status: "loaded", build: clonePlayerBuild(value) }; }
    catch { return { ok: false, status: "corrupt", build: null }; }
  }
  function save(build) {
    let serialized;
    try { serialized = JSON.stringify(clonePlayerBuild(build)); }
    catch { return { ok: false, status: "invalid-build" }; }
    // Never replace unreadable or future data through the normal save path.
    const current = load();
    if (!current.ok) return { ok: false, status: current.status };
    try { target().setItem(PLAYER_BUILD_STORAGE_KEY, serialized); }
    catch { return { ok: false, status: "storage-error" }; }
    return { ok: true, status: "saved" };
  }
  return { load, save };
}
