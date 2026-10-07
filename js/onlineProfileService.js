import { isOnlineUuid } from "./onlinePlayerDto.js";
import { clonePlayerBuild, createEmptyPlayerBuild, createEmptyDuck } from "./playerBuildModel.js";
import { canonicalEno } from "../supabase/functions/_shared/internal-email.mjs";
import { onlineFailure } from "./onlinePlayerStorage.js";

export const PUBLIC_PROFILE_VERSION = 2;
const requireValue = ok => { if (!ok) throw new TypeError("Invalid public profile"); };
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v, names) => requireValue(object(v) && Reflect.ownKeys(v).length === names.length && names.every(k => Object.hasOwn(v, k)));
const string = v => requireValue(typeof v === "string");
const array = (v, max) => requireValue(Array.isArray(v) && v.length <= max && Object.keys(v).length === v.length);
const optionKeys = new Set(["statusId", "amount", "amountPct", "multiplier", "baseAmount", "everyTurns", "stepAmount", "status", "duration", "maxHpPct", "direction", "activation", "scope", "preset", "diceAction"]);
function skill(v) {
  keys(v, ["selection", "label"]); keys(v.label, ["name", "ruby"]);
  string(v.label.name); string(v.label.ruby);
  // Selection structure is validated by the existing build model below. The public
  // API additionally fixes the currently supported option axes (no future fields).
  function options(value) {
    if (!object(value) && !Array.isArray(value)) return;
    for (const [k, child] of Object.entries(value)) {
      if (k === "options" && child !== null) requireValue(object(child) && Object.keys(child).every(axis => optionKeys.has(axis)));
      options(child);
    }
  }
  options(v.selection);
}
function duckProfile(v) {
  keys(v, ["text", "type", "attributes", "statLabelPreset", "flavorStats"]);
  string(v.text);
  requireValue([null, "attack", "defense", "speed", "heal", "technical", "normal"].includes(v.type));
  array(v.attributes, 3); requireValue(v.attributes.length === 3);
  v.attributes.forEach(a => { string(a); requireValue([...a].length <= 1); });
  requireValue(["default", "kanji", "english", "hiragana"].includes(v.statLabelPreset));
  array(v.flavorStats, 2);
  v.flavorStats.forEach(s => { keys(s, ["label", "value"]); string(s.label); requireValue(Number.isInteger(s.value) && s.value >= 0 && s.value <= 6); });
}
function featured(v) {
  if (v === null) return;
  keys(v, ["battleId", "battleNo", "dateISO", "result", "p1", "p2"]);
  requireValue(isOnlineUuid(v.battleId));
  v.battleNo = canonicalEno(v.battleNo);
  string(v.dateISO);
  requireValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v.dateISO) && Number.isFinite(Date.parse(v.dateISO)));
  requireValue(["P1_win", "P2_win", "draw"].includes(v.result));
  for (const side of [v.p1, v.p2]) {
    keys(side, ["eno", "battlerName", "duckName", "battlerDefaultIconUrl", "duckIconUrl"]);
    side.eno = canonicalEno(side.eno);
    for (const k of ["battlerName", "duckName", "battlerDefaultIconUrl", "duckIconUrl"]) string(side[k]);
  }
}

/** Independent public contract; no tolerant persistence normalization. */
export function decodeOnlineProfile(value) {
  keys(value, ["profileVersion", "accountId", "eno", "isOwner", "battler", "duck", "featuredBattle"]);
  requireValue(value.profileVersion === PUBLIC_PROFILE_VERSION && isOnlineUuid(value.accountId) && typeof value.isOwner === "boolean");
  const b = value.battler;
  keys(b, ["name", "standingImageUrl", "defaultIconUrl", "profileIcons", "profile", "skills"]);
  for (const k of ["name", "standingImageUrl", "defaultIconUrl"]) string(b[k]);
  array(b.profileIcons, 4);
  let last = 0;
  b.profileIcons.forEach(i => { keys(i, ["slot", "url"]); string(i.url); requireValue(Number.isInteger(i.slot) && i.slot > last && i.slot <= 10); last = i.slot; });
  keys(b.profile, ["text", "theme", "message", "messageTail"]); string(b.profile.text);
  string(b.profile.message); requireValue(typeof b.profile.messageTail === "boolean");
  keys(b.profile.theme, ["background", "panel", "text", "accent"]);
  Object.values(b.profile.theme).forEach(c => requireValue(typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)));
  keys(b.skills, ["B", "D"]); skill(b.skills.B); skill(b.skills.D);
  const build = createEmptyPlayerBuild();
  build.battler = { bSelection: b.skills.B.selection, dSelection: b.skills.D.selection,
    skillLabels: { B: b.skills.B.label, D: b.skills.D.label } };
  if (value.duck !== null) {
    const d = value.duck;
    keys(d, ["id", "name", "iconUrl", "profile", "stats", "skills"]);
    requireValue(isOnlineUuid(d.id)); string(d.name); string(d.iconUrl); duckProfile(d.profile);
    keys(d.stats, ["AT", "DF", "SP"]);
    Object.values(d.stats).forEach(s => requireValue(s === null || typeof s === "number" && Number.isFinite(s)));
    keys(d.skills, ["A", "C"]); skill(d.skills.A); skill(d.skills.C);
    build.ducks = [{ ...createEmptyDuck({ idFactory: () => d.id }), name: d.name, stats: d.stats,
      aSelection: d.skills.A.selection, cSelection: d.skills.C.selection, skillLabels: { A: d.skills.A.label, C: d.skills.C.label } }];
  }
  clonePlayerBuild(build, { allowOverlongText: true });
  const result = structuredClone(value);
  result.eno = canonicalEno(value.eno); featured(result.featuredBattle);
  return result;
}

export const profileFailure = status => ({ ...onlineFailure(status), message: {
  "profile-not-found": "指定されたENoのプロフィールが見つかりません。",
  "invalid-eno": "ENoを確認してください。",
  "migration-required": "プロフィール取得のDB準備が完了していません。",
  "unsupported-data": "プロフィールのデータ形式に対応していません。",
}[status] ?? onlineFailure(status).message });

/** Authenticated read only. Account resolution is intentionally unnecessary. */
export function createOnlineProfileService(client) {
  return {
    async getProfile(inputEno) {
      let eno;
      try { eno = canonicalEno(inputEno); } catch { return profileFailure("invalid-eno"); }
      try {
        const before = await client.auth.getSession();
        if (before.error) return profileFailure("load-failed");
        const identity = before.data?.session?.user?.id;
        if (!identity) return profileFailure("not-signed-in");
        let response;
        try { response = await client.rpc("get_online_profile", { p_eno: eno }); }
        catch { response = { error: {} }; }
        const after = await client.auth.getSession();
        if (after.error) return profileFailure("load-failed");
        if (after.data?.session?.user?.id !== identity) return profileFailure("session-changed");
        if (response.error) return profileFailure(
          ["PGRST202", "42883"].includes(response.error.code) ? "migration-required" :
          ["22023", "22P02"].includes(response.error.code) ? "unsupported-data" :
          response.error.code === "42501" ? "forbidden" : "load-failed");
        if (response.data === null) return profileFailure("profile-not-found");
        try {
          const profile = decodeOnlineProfile(response.data);
          requireValue(profile.eno === eno);
          return { ok: true, status: "loaded", profile };
        } catch { return profileFailure("unsupported-data"); }
      } catch { return profileFailure("load-failed"); }
    },
  };
}
