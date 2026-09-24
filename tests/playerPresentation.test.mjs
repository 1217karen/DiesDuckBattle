import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyPlayerPresentation, getQuoteIconUrlCandidates, normalizePlayerPresentation, resolveQuoteIconUrl } from "../js/playerPresentationModel.js";
import { createPlayerPresentationStorage, PLAYER_PRESENTATION_STORAGE_KEY } from "../js/playerPresentationStorage.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem:key => values.has(key) ? values.get(key) : null, setItem:(key, value) => values.set(key, value) };
}

test("presentationの初期値は固定10枠と全セリフを持つ", () => {
  const value = createEmptyPlayerPresentation();
  assert.equal(value.schemaVersion, 1);
  assert.deepEqual(value.battler.iconSlots, Array(10).fill(""));
  assert.deepEqual(value.battler.quotes.phaseStart.second, { text:"", iconSlot:null });
  assert.deepEqual(value.battler.quotes.skill.D, { text:"", iconSlot:null });
});

test("save/loadはBattler・セリフ・Duck別アイコンを保持する", () => {
  const backend = memoryStorage(); const storage = createPlayerPresentationStorage(backend);
  const value = createEmptyPlayerPresentation();
  value.battler.standingImageUrl = "standing.png";
  value.battler.iconSlots[2] = "icon-3.png";
  value.battler.quotes.skill.C = { text:"ここからだ！", iconSlot:3 };
  value.ducks.duckA = { iconUrl:"duck-a.png" }; value.ducks.duckB = { iconUrl:"duck-b.png" };
  assert.equal(storage.save(value).ok, true);
  assert.deepEqual(storage.load().presentation, value);
});

test("欠損と不正値を補完し、iconSlotは1〜10だけを許可する", () => {
  const value = normalizePlayerPresentation({ battler:{ iconSlots:["one", 2], quotes:{ battleStart:{ text:7, iconSlot:0 }, skill:{ A:{ text:"A", iconSlot:10 }, B:{ text:"B", iconSlot:11 } } } }, ducks:{ old:{}, bad:{ iconUrl:3 } } });
  assert.equal(value.battler.iconSlots.length, 10);
  assert.deepEqual(value.battler.iconSlots.slice(0, 2), ["one", ""]);
  assert.deepEqual(value.battler.quotes.battleStart, { text:"", iconSlot:null });
  assert.equal(value.battler.quotes.skill.A.iconSlot, 10);
  assert.equal(value.battler.quotes.skill.B.iconSlot, null);
  assert.deepEqual(value.ducks.old, { iconUrl:"" });
});

test("未登録・不正な追加slotはdefaultIconUrlへfallbackする", () => {
  const value = createEmptyPlayerPresentation(); value.battler.defaultIconUrl = "default.png"; value.battler.iconSlots[0] = "one.png";
  assert.equal(resolveQuoteIconUrl(value, { iconSlot:1 }), "one.png");
  assert.equal(resolveQuoteIconUrl(value, { iconSlot:2 }), "default.png");
  assert.equal(resolveQuoteIconUrl(value, { iconSlot:99 }), "default.png");
  assert.equal(resolveQuoteIconUrl(value, { iconSlot:null }), "default.png");
  assert.deepEqual(getQuoteIconUrlCandidates(value, { iconSlot:1 }), ["one.png", "default.png"]);
});

test("不正JSONでもloadは初期値を返して画面を継続できる", () => {
  const storage = createPlayerPresentationStorage(memoryStorage({ [PLAYER_PRESENTATION_STORAGE_KEY]: "{" }));
  const loaded = storage.load();
  assert.equal(loaded.ok, false); assert.equal(loaded.status, "corrupt");
  assert.equal(loaded.presentation.battler.iconSlots.length, 10);
});
