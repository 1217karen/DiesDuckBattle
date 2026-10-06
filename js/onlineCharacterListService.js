import { canonicalEno } from "../supabase/functions/_shared/internal-email.mjs";
export const CHARACTER_TYPES = Object.freeze({attack:"アタック",defense:"ディフェンス",speed:"スピード",heal:"ヒール",technical:"テクニカル",normal:"ノーマル"});
const check = value => { if (!value) throw new TypeError("Invalid character list"); };
const keys = (v, expected) => check(v !== null && typeof v === "object" && !Array.isArray(v)
  && Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v,k)));
export function decodeOnlineCharacters(value) {
  check(Array.isArray(value));
  const seen = new Set();
  for (const v of value) {
    keys(v,["eno","battlerName","battlerIconUrl","accent","duck","bestStreak"]);
    check(typeof v.eno === "string" && canonicalEno(v.eno) === v.eno && !seen.has(v.eno)); seen.add(v.eno);
    check(typeof v.battlerName === "string" && typeof v.battlerIconUrl === "string");
    check(typeof v.accent === "string" && /^#[0-9a-f]{6}$/i.test(v.accent));
    check(v.bestStreak === null || Number.isSafeInteger(v.bestStreak) && v.bestStreak >= 0);
    if (v.duck !== null) {
      const d=v.duck; keys(d,["name","iconUrl","type","attributes"]);
      check(typeof d.name === "string" && typeof d.iconUrl === "string");
      check(d.type === null || typeof d.type === "string" && Object.hasOwn(CHARACTER_TYPES,d.type));
      check(Array.isArray(d.attributes) && d.attributes.length === 3 && Object.keys(d.attributes).length===3
        && d.attributes.every(a=>typeof a === "string" && [...a].length <= 1));
    }
  }
  return structuredClone(value);
}
const failure = () => ({ok:false,message:"キャラリストを読み込めませんでした。再度ページを開いてください。"});
export function createOnlineCharacterListService(client) {
  return { async list() {
    try {
      const before=await client.auth.getSession(),id=before.data?.session?.user?.id;
      if (before.error || !id) return failure();
      const response=await client.rpc("list_online_characters");
      const after=await client.auth.getSession();
      if(response.error || after.error || after.data?.session?.user?.id!==id) return failure();
      return {ok:true,characters:decodeOnlineCharacters(response.data)};
    } catch { return failure(); }
  }};
}
