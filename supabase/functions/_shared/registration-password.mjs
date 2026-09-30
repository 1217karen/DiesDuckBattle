// Public, dependency-free rule shared by registration UI and Edge Function.
// Count Unicode code points; preserve whitespace and allow additional characters.
export const MIN_REGISTRATION_PASSWORD_LENGTH = 6;
export function registrationPasswordError(value) {
  if (typeof value !== "string") return "invalid_input";
  if (Array.from(value).length < MIN_REGISTRATION_PASSWORD_LENGTH) return "password_too_short";
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return "password_alphanumeric_required";
  return null;
}
