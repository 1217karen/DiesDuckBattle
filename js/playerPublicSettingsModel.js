export const PLAYER_PUBLIC_SETTINGS_SCHEMA_VERSION = 1;

export function createEmptyPlayerPublicSettings() {
  return { schemaVersion: PLAYER_PUBLIC_SETTINGS_SCHEMA_VERSION, publicDuckId: null };
}

/**
 * Public settings are deliberately separate from battle build and presentation.
 * Malformed draft fields normalize to their safe, unpublished value.
 */
export function normalizePlayerPublicSettings(value) {
  return {
    schemaVersion: PLAYER_PUBLIC_SETTINGS_SCHEMA_VERSION,
    publicDuckId: typeof value?.publicDuckId === "string" && value.publicDuckId.length > 0
      ? value.publicDuckId : null,
  };
}

export function clonePlayerPublicSettings(value) {
  return normalizePlayerPublicSettings(value);
}

/** A stale saved ID is unpublished in the current build without mutating storage. */
export function resolvePublicDuckId(settings, build) {
  const id = normalizePlayerPublicSettings(settings).publicDuckId;
  return build?.ducks?.some(duck => duck.id === id) ? id : null;
}
