// 運営側のtrustedダイスタイプ定義。保存するのはID・dice・stats.SPのみ。
const standard = (id, label, SP, faces, initialDice) => Object.freeze({
  id, kind: "standard", label, SP, faces: Object.freeze(faces), initialDice: Object.freeze(initialDice), editable: true,
});
const preset = (id, label, SP, dice, dicePoints) => Object.freeze({
  id, kind: "preset", label, SP, dice: Object.freeze(dice), dicePoints, editable: false,
  faces: Object.freeze([...new Set(dice.filter(face => face !== 0))].sort((a,b)=>a-b)),
});
export const DICE_FRAMES = Object.freeze({
  "custom-speed": standard("custom-speed", "スピード", 3, [1,2,3,4], [1,2,3,4,0,0]),
  "custom-normal": standard("custom-normal", "ノーマル", 2, [2,3,4,5], [0,2,3,4,5,0]),
  "custom-heavy": standard("custom-heavy", "ヘビー", 1, [3,4,5,6], [0,0,3,4,5,6]),
  "preset-standard": preset("preset-standard", "スタンダード", 2, [1,2,3,4,5,6], 0),
  "preset-void": preset("preset-void", "ヴォイド", 1, [0,0,0,0,0,0], 4),
});
export function getDiceFrame(id) {
  return typeof id === "string" && Object.hasOwn(DICE_FRAMES, id) ? DICE_FRAMES[id] : undefined;
}
export function matchesPresetDice(frame, dice) {
  return frame?.kind === "preset" && Array.isArray(dice) && dice.length === frame.dice.length
    && frame.dice.every((face, index) => dice[index] === face);
}
