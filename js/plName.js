// An optional public label per ENo, never an account identity.
export const PL_NAME_MAX = 30;
export const normalizePlName = value => value.trim();
export function plNameError(value) {
  if (typeof value !== "string") return "PL名は文字列で入力してください。";
  if (/[\r\n\u2028\u2029]/u.test(value)) return "PL名は1行で入力してください。";
  return [...normalizePlName(value)].length > PL_NAME_MAX ? `PL名は${PL_NAME_MAX}文字まで入力できます。` : "";
}
