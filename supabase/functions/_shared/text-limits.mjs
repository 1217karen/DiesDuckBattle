// Pure shared validation for browser and registration Edge Function.
export const BATTLER_NAME_MAX = 15;
export const codePointLength = value => [...value].length;
export function battlerNameError(value) {
  if (typeof value !== "string" || !value.trim()) return "バトラー名を入力してください（空白のみは使用できません）。";
  return codePointLength(value) > BATTLER_NAME_MAX ? `バトラー名は${BATTLER_NAME_MAX}文字まで入力できます。` : "";
}
