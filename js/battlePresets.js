// Operator-maintained samples using the same production selection IDs as saved DTOs.
// Adjust sample builds here; pricing and legality remain in the production catalogs/compilers.
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const BATTLER_PRESETS = freeze([
  { id: "attack", label: "アタック", description: "HPが半分以上の間はATを強化。出目2を追加して通常攻撃を狙う構成です。",
    bSelection: { type: "trait", traitId: "hp-mid-high-at", options: {} }, dSelection: { optionId: "add-self-2" } },
  { id: "defense", label: "ディフェンス", description: "HPが半分以上の間はDFを強化。出目4を追加して反撃を狙う構成です。",
    bSelection: { type: "trait", traitId: "hp-mid-high-df", options: {} }, dSelection: { optionId: "add-self-4" } },
  { id: "support", label: "サポート", description: "HP回復時の回復量を補助。出目3を追加して回復の機会を増やす構成です。",
    bSelection: { type: "event", triggerId: "after-heal", conditionId: "always", effectId: "heal", targetId: "healTarget", options: {} },
    dSelection: { optionId: "add-self-3" } },
]);
export const DUCK_PRESETS = freeze([
  { id: "attack", label: "アタック", description: "ATを高めたヘビーダイス型。A・Cの固定ダメージで攻撃を補います。",
    stats: { AT: 5, DF: 3, SP: 1 }, diceFrame: "custom-heavy", dice: [0,0,3,4,5,6],
    aSelection: { triggerId: "exact:0", effects: [{ effectId: "damage", targetId: "enemy", options: { amount: "amount-3" } }] },
    cSelection: { mode: "normal", structure: { kind: "flat", effects: [{ effectId: "damage", targetId: "enemy", options: { amount: "damageAmount-50" } }] } } },
  { id: "defense", label: "ディフェンス", description: "DFを高めたノーマルダイス型。Aで反撃を付与し、CでDFを補強します。",
    stats: { AT: 2, DF: 5, SP: 2 }, diceFrame: "custom-normal", dice: [0,2,3,4,5,0],
    aSelection: { triggerId: "exact:0", effects: [{ effectId: "grant-status", targetId: "self", statusId: "counter", options: { amount: "amount-1" } }] },
    cSelection: { mode: "normal", structure: { kind: "flat", effects: [{ effectId: "change-df", targetId: "self", options: { direction: "increase", amount: "turnDFAmount-2", duration: "turnCount-2" } }] } } },
  { id: "heal", label: "ヒール", description: "行動回数の多いスピードダイス型。A・CでHPを回復しながら戦います。",
    stats: { AT: 2, DF: 4, SP: 3 }, diceFrame: "custom-speed", dice: [1,2,3,4,0,0],
    aSelection: { triggerId: "exact:0", effects: [{ effectId: "heal", targetId: "self", options: { amount: "amount-5" } }] },
    cSelection: { mode: "normal", structure: { kind: "flat", effects: [{ effectId: "heal", targetId: "self", options: { amount: "healAmount-30" } }] } } },
]);

// Explicit allowlists keep sample metadata and identity/presentation out of draft patches.
export function battlerPresetPatch(id) {
  const preset = BATTLER_PRESETS.find(p => p.id === id);
  if (!preset) throw new RangeError("Unknown battler preset");
  return structuredClone({ bSelection: preset.bSelection, dSelection: preset.dSelection });
}
export function duckPresetPatch(id) {
  const preset = DUCK_PRESETS.find(p => p.id === id);
  if (!preset) throw new RangeError("Unknown Duck preset");
  return structuredClone({ stats: preset.stats, diceFrame: preset.diceFrame, dice: preset.dice,
    aSelection: preset.aSelection, cSelection: preset.cSelection });
}
export function hasBattlerPresetSettings(battler) {
  return battler.bSelection !== null || battler.dSelection !== null;
}
export function hasDuckPresetSettings(duck) {
  return Object.values(duck.stats).some(v => v !== null) || duck.diceFrame !== null
    || duck.dice.some(v => v !== 0) || duck.aSelection !== null || duck.cSelection !== null;
}
