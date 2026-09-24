import {
  PLAYER_PUBLIC_SETTINGS_SCHEMA_VERSION,
  createEmptyPlayerPublicSettings,
  normalizePlayerPublicSettings,
} from "./playerPublicSettingsModel.js";

export const PLAYER_PUBLIC_SETTINGS_STORAGE_KEY = "diesDuckBattle:public-settings:v1";

export function createPlayerPublicSettingsStorage(storage) {
  const target = () => storage ?? globalThis.localStorage;

  function load() {
    let raw;
    try { raw = target().getItem(PLAYER_PUBLIC_SETTINGS_STORAGE_KEY); }
    catch { return { ok: false, status: "storage-error", settings: null }; }
    if (raw === null) return { ok: true, status: "empty", settings: createEmptyPlayerPublicSettings() };
    let value;
    try { value = JSON.parse(raw); }
    catch { return { ok: false, status: "corrupt", settings: null }; }
    if (Number.isInteger(value?.schemaVersion)
      && value.schemaVersion !== PLAYER_PUBLIC_SETTINGS_SCHEMA_VERSION) {
      return { ok: false, status: "unsupported-version", schemaVersion: value.schemaVersion, settings: null };
    }
    return { ok: true, status: "loaded", settings: normalizePlayerPublicSettings(value) };
  }

  function save(settings) {
    const current = load();
    if (!current.ok) return { ok: false, status: current.status };
    const normalized = normalizePlayerPublicSettings(settings);
    try { target().setItem(PLAYER_PUBLIC_SETTINGS_STORAGE_KEY, JSON.stringify(normalized)); }
    catch { return { ok: false, status: "storage-error" }; }
    return { ok: true, status: "saved", settings: normalized };
  }

  return { load, save };
}
