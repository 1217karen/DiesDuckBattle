// Stable engine IDs, grouping and human labels live in this one metadata table.
export const STATUS_METADATA = Object.freeze([
  ["crack", "亀裂", "debuff"], ["Headwind", "向かい風", "debuff"], ["roughWave", "荒波", "debuff"],
  ["tailwind", "追風", "buff"], ["focus", "集中", "buff"], ["counter", "反撃", "buff"],
  ["clean", "清潔", "buff"], ["steam", "湯気", "debuff"],
].map(([id,label,group]) => Object.freeze({id,label,group})));
export const STATUS_LABELS = Object.freeze(Object.fromEntries(STATUS_METADATA.map(({id,label})=>[id,label])));
export function statusLabel(id) {
  return STATUS_LABELS[id] ?? ({ "@debuff": "ランダム状態異常", "@buff": "ランダム強化状態", "random-debuff": "ランダム状態異常", "random-buff": "ランダム強化状態", "@mixed": "強化状態と状態異常" })[id] ?? id;
}
