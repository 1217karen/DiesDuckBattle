import { STATUS_METADATA } from "./statusMetadata.js";
// Preserve engine group membership and @all iteration order exactly.
export const STATUS_GROUPS = Object.freeze({
  all: Object.freeze(STATUS_METADATA.map(({id}) => id)),
  debuff: Object.freeze(STATUS_METADATA.filter(({group}) => group === "debuff").map(({id}) => id)),
  buff: Object.freeze(STATUS_METADATA.filter(({group}) => group === "buff").map(({id}) => id)),
});
