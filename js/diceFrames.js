// 運営側の信頼済み素体定義。validatorと将来のbuildCompilerは同じ定義を参照する。
// 0は出目アイテムではなく空き枠なので、非0出目の一覧には含めない。
export const DICE_FRAMES = Object.freeze({
  light: Object.freeze({ SP: 3, faces: Object.freeze([1, 2, 3, 4]) }),
  basic: Object.freeze({ SP: 2, faces: Object.freeze([2, 3, 4, 5]) }),
  heavy: Object.freeze({ SP: 1, faces: Object.freeze([3, 4, 5, 6]) }),
});

export function getDiceFrame(id) {
  return typeof id === "string" && Object.hasOwn(DICE_FRAMES, id)
    ? DICE_FRAMES[id] : undefined;
}
