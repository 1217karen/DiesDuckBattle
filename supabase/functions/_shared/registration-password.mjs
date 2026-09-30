// Public, dependency-free rule shared by registration UI and Edge Function.
// Count characters without trimming or imposing character-class requirements.
export const MIN_REGISTRATION_PASSWORD_LENGTH = 6;
export const isRegistrationPasswordLongEnough = value =>
  typeof value === "string" && Array.from(value).length >= MIN_REGISTRATION_PASSWORD_LENGTH;
