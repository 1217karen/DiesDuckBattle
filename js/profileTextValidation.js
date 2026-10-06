import { codePointLength } from "./nameValidation.js";
export const BATTLER_PROFILE_MAX = 2000;
export const DUCK_PROFILE_MAX = 300;
export const FLAVOR_LABEL_WIDTH_MAX = 10;
export function textDisplayWidth(value) {
  return [...value].reduce((width, char) => {
    const code = char.codePointAt(0);
    return width + (code <= 0x7f || code >= 0xff61 && code <= 0xff9f ? 1 : 2);
  }, 0);
}
export const profileTextError = (value, limit, label) => codePointLength(value) > limit ? `${label}は${limit}文字まで入力できます。` : "";
export const flavorLabelError = value => textDisplayWidth(value) > FLAVOR_LABEL_WIDTH_MAX
  ? `名前は全角${FLAVOR_LABEL_WIDTH_MAX / 2}文字・半角${FLAVOR_LABEL_WIDTH_MAX}文字相当まで入力できます。` : "";
/** Save-only constraints: read/migration paths preserve old text for repair. */
export function presentationTextIssues(presentation) {
  const issues = [];
  const battler = profileTextError(presentation.battler.profile.text, BATTLER_PROFILE_MAX, "バトラープロフィール");
  if (battler) issues.push({ duckId: null, message: battler });
  for (const [duckId, duck] of Object.entries(presentation.ducks)) {
    const message = profileTextError(duck.profile.text, DUCK_PROFILE_MAX, "アヒルプロフィール");
    if (message) issues.push({ duckId, message });
    for (const stat of duck.profile.flavorStats) {
      const message = flavorLabelError(stat.label);
      if (message) issues.push({ duckId, message });
    }
  }
  return issues;
}
