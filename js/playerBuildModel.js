export const PLAYER_BUILD_SCHEMA_VERSION = 2;

const record = value => value !== null && typeof value === "object"
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const requireShape = (ok, path) => {
  if (!ok) throw new TypeError(`Invalid player build: ${path}`);
};

// Reject lossy JSON values, accessors and non-data objects before serialization.
function cloneData(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  requireShape(Array.isArray(value) || record(value), "plain JSON data required");
  requireShape(!ancestors.has(value), "cyclic data");
  ancestors.add(value);
  const array = Array.isArray(value);
  const result = array ? [] : {};
  const keys = Reflect.ownKeys(value).filter(key => !(array && key === "length"));
  if (array) requireShape(keys.length === value.length
    && keys.every((key, i) => key === String(i)), "dense array required");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireShape(typeof key === "string" && descriptor.enumerable && Object.hasOwn(descriptor, "value"), "data property required");
    Object.defineProperty(result, key, { value: cloneData(descriptor.value, ancestors),
      enumerable: true, writable: true, configurable: true });
  }
  ancestors.delete(value);
  return result;
}

function fields(value, allowed, path, required = allowed) {
  requireShape(record(value) && Object.keys(value).every(key => allowed.includes(key))
    && required.every(key => Object.hasOwn(value, key)), path);
}
const nullableString = value => value === null || typeof value === "string";
const nullableNumber = value => value === null || Number.isFinite(value);

// Structural boundary for the existing compiler DTOs, including partial drafts.
// No catalog lookup, option legality, costs, counts or compiler invocation here.
function selection(value, category, version) {
  if (value === null) return;
  const strings = (object, allowed) => {
    fields(object, allowed, `${category} selection`, []);
    for (const v of Object.values(object)) requireShape(nullableString(v), `${category} selection ID`);
  };
  const options = value => {
    if (value === null) return;
    requireShape(record(value), `${category} options`);
    for (const v of Object.values(value)) requireShape(nullableString(v), `${category} option ID`);
  };
  const effects = value => {
    if (value === null) return;
    requireShape(Array.isArray(value), `${category} effects`);
    for (const item of value) {
      if (item === null) continue;
      if (category === "A" && version === 1) strings(item, ["effectId", "amountOptionId", "chanceOptionId"]);
      else {
        fields(item, version === 2 ? ["effectId", "targetId", "statusId", "options", "chanceOptionId"] : ["effectId", "options", "chanceOptionId"], "C effect selection", []);
        for (const [key, v] of Object.entries(item)) {
          if (key === "options") options(v);
          else requireShape(nullableString(v), "C effect ID");
        }
      }
    }
  };
  const branch = value => {
    if (value === null) return;
    fields(value, ["effects"], "C branch", []);
    if (Object.hasOwn(value, "effects")) effects(value.effects);
  };
  if (category === "D") strings(value, ["optionId"]);
  if (category === "B") {
    fields(value, ["type", "triggerId", "conditionId", "effectId", "traitId", "options", ...(version === 2 ? ["targetId", "statusId"] : [])], "B selection", []);
    for (const [key, v] of Object.entries(value)) {
      if (key === "options") options(v);
      else requireShape(nullableString(v), "B selection ID");
    }
  }
  if (category === "A") {
    fields(value, ["triggerId", "effects"], "A selection", []);
    if (Object.hasOwn(value, "triggerId")) requireShape(nullableString(value.triggerId), "A triggerId");
    if (Object.hasOwn(value, "effects")) effects(value.effects);
  }
  if (category === "C") {
    fields(value, ["mode", "structure"], "C selection", []);
    if (Object.hasOwn(value, "mode")) requireShape(nullableString(value.mode), "C mode");
    if (!Object.hasOwn(value, "structure") || value.structure === null) return;
    const s = value.structure;
    fields(s, ["kind", "effects", "branches", "thresholdOptionId"], "C structure", []);
    for (const key of ["kind", "thresholdOptionId"]) {
      if (Object.hasOwn(s, key)) requireShape(nullableString(s[key]), `C ${key}`);
    }
    if (Object.hasOwn(s, "effects")) effects(s.effects);
    if (Object.hasOwn(s, "branches") && s.branches !== null) {
      if (Array.isArray(s.branches)) s.branches.forEach(branch);
      else {
        fields(s.branches, ["met", "unmet"], "C branches", []);
        Object.values(s.branches).forEach(branch);
      }
    }
  }
}

function checkDuck(duck, version = PLAYER_BUILD_SCHEMA_VERSION) {
  fields(duck, ["id", "name", "stats", "diceFrame", "dice", "aSelection", "cSelection"], "duck");
  requireShape(typeof duck.id === "string" && duck.id.trim().length > 0, "duck.id");
  requireShape(typeof duck.name === "string", "duck.name");
  fields(duck.stats, ["AT", "DF", "SP"], "duck.stats");
  requireShape(Object.values(duck.stats).every(nullableNumber), "duck.stats values");
  requireShape(nullableString(duck.diceFrame), "duck.diceFrame");
  requireShape(Array.isArray(duck.dice) && duck.dice.length === 6 && duck.dice.every(Number.isFinite), "duck.dice");
  selection(duck.aSelection, "A", version);
  selection(duck.cSelection, "C", version);
}

/** Validate only persistence shape and return a completely detached copy. */
export function clonePlayerBuild(build) {
  const copy = cloneData(build);
  fields(copy, ["schemaVersion", "battler", "ducks"], "root");
  requireShape([1, PLAYER_BUILD_SCHEMA_VERSION].includes(copy.schemaVersion), "schemaVersion");
  fields(copy.battler, ["bSelection", "dSelection"], "battler");
  selection(copy.battler.bSelection, "B", copy.schemaVersion);
  selection(copy.battler.dSelection, "D", copy.schemaVersion);
  requireShape(Array.isArray(copy.ducks), "ducks");
  copy.ducks.forEach(duck => checkDuck(duck, copy.schemaVersion));
  requireShape(new Set(copy.ducks.map(duck => duck.id)).size === copy.ducks.length, "duplicate duck ID");
  return copy;
}

export function createEmptyPlayerBuild() {
  return { schemaVersion: PLAYER_BUILD_SCHEMA_VERSION,
    battler: { bSelection: null, dSelection: null }, ducks: [] };
}

// Called only on creation; never derived from an index, name or existing IDs.
export function generateDuckId() {
  return globalThis.crypto.randomUUID();
}

export function createEmptyDuck({ idFactory = generateDuckId } = {}) {
  const duck = { id: idFactory(), name: "", stats: { AT: null, DF: null, SP: null },
    diceFrame: null, dice: [0, 0, 0, 0, 0, 0], aSelection: null, cSelection: null };
  checkDuck(duck);
  return duck;
}

/** Add a detached Duck (or create a new draft when omitted). */
export function addDuck(build, duck = createEmptyDuck()) {
  const next = clonePlayerBuild(build);
  next.ducks.push(duck);
  return clonePlayerBuild(next);
}

function duckIndex(build, id) {
  const index = build.ducks.findIndex(duck => duck.id === id);
  if (index < 0) throw new RangeError(`Unknown Duck ID: ${id}`);
  return index;
}

export function duplicateDuck(build, id, { idFactory = generateDuckId } = {}) {
  const next = clonePlayerBuild(build);
  const duck = next.ducks[duckIndex(next, id)];
  next.ducks.push({ ...duck, id: idFactory() });
  return clonePlayerBuild(next);
}

/** Patch fields; stats/selection/dice are replaced as whole values. ID is immutable. */
export function updateDuck(build, id, patch) {
  const next = clonePlayerBuild(build);
  const data = cloneData(patch);
  fields(data, ["name", "stats", "diceFrame", "dice", "aSelection", "cSelection"], "duck patch", []);
  const index = duckIndex(next, id);
  next.ducks[index] = { ...next.ducks[index], ...data };
  return clonePlayerBuild(next);
}

export function deleteDuck(build, id) {
  const next = clonePlayerBuild(build);
  next.ducks.splice(duckIndex(next, id), 1);
  return next;
}

export function updateBattler(build, patch) {
  const next = clonePlayerBuild(build);
  const data = cloneData(patch);
  fields(data, ["bSelection", "dSelection"], "battler patch", []);
  next.battler = { ...next.battler, ...data };
  return clonePlayerBuild(next);
}
