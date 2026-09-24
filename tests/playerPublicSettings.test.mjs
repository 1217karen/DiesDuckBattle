import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyPlayerPublicSettings,
  normalizePlayerPublicSettings,
  resolvePublicDuckId,
} from "../js/playerPublicSettingsModel.js";
import {
  createPlayerPublicSettingsStorage,
  PLAYER_PUBLIC_SETTINGS_STORAGE_KEY,
} from "../js/playerPublicSettingsStorage.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("初期値は公開Duck未設定", () => {
  assert.deepEqual(createEmptyPlayerPublicSettings(), { schemaVersion: 1, publicDuckId: null });
});

test("独立keyでsave/loadしstring IDを維持する", () => {
  const backend = memoryStorage();
  const storage = createPlayerPublicSettingsStorage(backend);
  assert.equal(storage.load().status, "empty");
  assert.equal(storage.save({ schemaVersion: 1, publicDuckId: "duck-b" }).ok, true);
  assert.deepEqual(storage.load().settings, { schemaVersion: 1, publicDuckId: "duck-b" });
  assert.deepEqual(JSON.parse(backend.values.get(PLAYER_PUBLIC_SETTINGS_STORAGE_KEY)),
    { schemaVersion: 1, publicDuckId: "duck-b" });
});

test("欠損fieldと不正publicDuckIdはnullへnormalizeする", () => {
  for (const value of [{}, { publicDuckId: 42 }, { publicDuckId: "" }, { publicDuckId: [] }]) {
    assert.deepEqual(normalizePlayerPublicSettings(value), { schemaVersion: 1, publicDuckId: null });
  }
});

test("不正JSONと未知versionは上書きせず判別できる", () => {
  for (const [raw, status] of [["{", "corrupt"], ['{"schemaVersion":2,"publicDuckId":null}', "unsupported-version"]]) {
    const backend = memoryStorage({ [PLAYER_PUBLIC_SETTINGS_STORAGE_KEY]: raw });
    const storage = createPlayerPublicSettingsStorage(backend);
    assert.equal(storage.load().status, status);
    assert.equal(storage.save(createEmptyPlayerPublicSettings()).status, status);
    assert.equal(backend.values.get(PLAYER_PUBLIC_SETTINGS_STORAGE_KEY), raw);
  }
});

test("現在のbuildに存在しないIDとDuck 0件は未公開として解決する", () => {
  const settings = { schemaVersion: 1, publicDuckId: "gone" };
  assert.equal(resolvePublicDuckId(settings, { ducks: [] }), null);
  assert.equal(resolvePublicDuckId(settings, { ducks: [{ id: "other" }] }), null);
  assert.equal(resolvePublicDuckId(settings, { ducks: [{ id: "gone" }] }), "gone");
});
