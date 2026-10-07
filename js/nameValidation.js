import { codePointLength } from "../supabase/functions/_shared/text-limits.mjs";
export { BATTLER_NAME_MAX, battlerNameError, codePointLength } from "../supabase/functions/_shared/text-limits.mjs";
export const DUCK_NAME_MAX = 21;
export const hasName = value => typeof value === "string" && value.trim().length > 0;
export function duckNameError(value) {
  if (!hasName(value)) return "アヒル名を入力してください（空白のみは使用できません）。";
  return codePointLength(value) > DUCK_NAME_MAX ? `アヒル名は${DUCK_NAME_MAX}文字まで入力できます。` : "";
}
export function duckNameIssues(build) {
  return (build?.ducks ?? []).flatMap((duck, index) => {
    const message = duckNameError(duck.name);
    return message ? [{ section: "name", duckId: duck.id, ownerName: duck.name || `アヒル ${index + 1}`,
      code: hasName(duck.name) ? "NAME_TOO_LONG" : "NAME_REQUIRED", path: "name", message }] : [];
  });
}
