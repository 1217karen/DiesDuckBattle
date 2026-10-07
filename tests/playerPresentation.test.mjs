import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyDuckProfile, createEmptyPlayerPresentation, getQuoteIconUrlCandidates, normalizePlayerPresentation, resolveQuoteIconUrl } from "../js/playerPresentationModel.js";
import { createPlayerPresentationStorage, PLAYER_PRESENTATION_STORAGE_KEY } from "../js/playerPresentationStorage.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem:key => values.has(key) ? values.get(key) : null, setItem:(key, value) => values.set(key, value) };
}

test("presentationの初期値は固定10枠と全セリフを持つ", () => {
  const value = createEmptyPlayerPresentation();
  assert.equal(value.schemaVersion,5);
  assert.deepEqual(value.battler.iconSlots, Array(10).fill(""));
  assert.deepEqual(value.battler.quotes.phaseStart.second, { lines:[{ text:"", iconSlot:null, opponentEno:null }] });
  assert.deepEqual(value.battler.quotes.skill.D, { lines:[{ text:"", iconSlot:null, opponentEno:null }] });
});

test("save/loadはBattler・セリフ・Duck別アイコンを保持する", () => {
  const backend = memoryStorage(); const storage = createPlayerPresentationStorage(backend);
  const value = createEmptyPlayerPresentation();
  value.battler.standingImageUrl = "standing.png";
  value.battler.iconSlots[2] = "icon-3.png";
  value.battler.quotes.skill.C = { lines: [{ text:"ここからだ！", iconSlot:3 , opponentEno:null}] };
  value.ducks.duckA = { iconUrl:"duck-a.png", cutinUrl:"cutin-a.png" , profile:createEmptyDuckProfile() }; value.ducks.duckB = { iconUrl:"duck-b.png", cutinUrl:"" , profile:createEmptyDuckProfile() };
  assert.equal(storage.save(value).ok, true);
  assert.deepEqual(storage.load().presentation, value);
});

test("欠損と不正値を補完し、iconSlotは1〜10だけを許可する", () => {
  const value = normalizePlayerPresentation({ battler:{ iconSlots:["one", 2], quotes:{ battleStart:{ text:7, iconSlot:0 }, skill:{ A:{ text:"A", iconSlot:10 }, B:{ text:"B", iconSlot:11 } } } }, ducks:{ old:{}, bad:{ iconUrl:3 , profile:createEmptyDuckProfile() } } });
  assert.equal(value.battler.iconSlots.length, 10);
  assert.deepEqual(value.battler.iconSlots.slice(0, 2), ["one", ""]);
  assert.deepEqual(value.battler.quotes.battleStart, { lines:[{ text:"", iconSlot:null, opponentEno:null }] });
  assert.equal(value.battler.quotes.skill.A.lines[0].iconSlot, 10);
  assert.equal(value.battler.quotes.skill.B.lines[0].iconSlot, null);
  assert.deepEqual(value.ducks.old, { iconUrl:"", cutinUrl:"" , profile:createEmptyDuckProfile() });
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

test("v1 old Duck icons gain empty cut-ins; normalized cut-ins are independent Duck data",()=>{
  const raw={schemaVersion:1,ducks:{old:{iconUrl:"old.png"},a:{iconUrl:"a.png",cutinUrl:"a-cutin.png"},b:{iconUrl:"b.png",cutinUrl:"b-cutin.png"}}};
  const before=structuredClone(raw),value=normalizePlayerPresentation(raw);
  assert.deepEqual(raw,before);assert.equal(value.schemaVersion,5);
  assert.deepEqual(value.ducks.old,{ iconUrl:"old.png",cutinUrl:"", profile:createEmptyDuckProfile() });
  assert.deepEqual(value.ducks.a,{...raw.ducks.a,profile:createEmptyDuckProfile()});assert.deepEqual(value.ducks.b,{...raw.ducks.b,profile:createEmptyDuckProfile()});
});
