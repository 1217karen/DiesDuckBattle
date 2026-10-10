// Operator-maintained samples using the same production selection IDs as saved DTOs.
// Adjust sample builds here; pricing and legality remain in the production catalogs/compilers.
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const BATTLER_PRESETS = freeze([
  {
    "id": "attack",
    "label": "アタック",
    "description": "HPが半分以上の間はATを強化。出目6を追加してDF無視攻撃を狙います。",
    "bSelection": {
      "type": "trait",
      "traitId": "hp-mid-high-at",
      "options": {}
    },
    "dSelection": {
      "optionId": "add-self-6"
    }
  },
  {
    "id": "defense",
    "label": "ディフェンス",
    "description": "通常攻撃を受けると反撃を1付与。出目4も追加して反撃で応じます。",
    "bSelection": {
      "type": "event",
      "triggerId": "after-take-hit",
      "conditionId": "always",
      "effectId": "grant-status",
      "targetId": "self",
      "statusId": "counter",
      "options": {
        "activation": "guaranteed"
      }
    },
    "dSelection": {
      "optionId": "add-self-4"
    }
  },
  {
    "id": "heal",
    "label": "ヒール",
    "description": "HP回復時に回復対象を追加回復。出目3を追加して回復の機会を増やします。",
    "bSelection": {
      "type": "event",
      "triggerId": "after-heal",
      "conditionId": "always",
      "effectId": "heal",
      "targetId": "healTarget",
      "options": {}
    },
    "dSelection": {
      "optionId": "add-self-3"
    }
  },
  {
    "id": "technical",
    "label": "テクニカル",
    "description": "自分フェイズ開始時、50%でランダムな強化状態を1付与。出目2を追加して連続攻撃を狙います。",
    "bSelection": {
      "type": "event",
      "triggerId": "phase-start",
      "conditionId": "always",
      "effectId": "grant-status",
      "targetId": "self",
      "statusId": "@buff",
      "options": {
        "activation": "chance"
      }
    },
    "dSelection": {
      "optionId": "add-self-2"
    }
  }
]);
export const DUCK_PRESETS = freeze([
  {
    "id": "attack",
    "label": "アタック",
    "description": "出目5以上で次の通常攻撃ATを+2。Cで固定50ダメージと2ターンのAT+3を得るヘビー型です。",
    "stats": {
      "AT": 5,
      "DF": 3,
      "SP": 1
    },
    "diceFrame": "custom-heavy",
    "dice": [
      3,
      4,
      4,
      5,
      6,
      6
    ],
    "aSelection": {
      "triggerId": "gte:5",
      "effects": [
        {
          "effectId": "change-next-at",
          "targetId": "self",
          "options": {
            "direction": "increase",
            "amount": "amount-2"
          }
        }
      ]
    },
    "cSelection": {
      "mode": "normal",
      "structure": {
        "kind": "flat",
        "effects": [
          {
            "effectId": "damage",
            "targetId": "enemy",
            "chanceOptionId": "100",
            "options": {
              "amount": "damageAmount-50"
            }
          },
          {
            "effectId": "change-at",
            "targetId": "self",
            "options": {
              "direction": "increase",
              "amount": "turnATAmount-3",
              "duration": "turnCount-2"
            }
          }
        ]
      }
    }
  },
  {
    "id": "defense",
    "label": "ディフェンス",
    "description": "出目4以下で追風を2付与。特殊Cで最大HPの10%で復活し、経過ターンに応じた固定ダメージを返します。",
    "stats": {
      "AT": 2,
      "DF": 5,
      "SP": 2
    },
    "diceFrame": "custom-normal",
    "dice": [
      0,
      3,
      3,
      4,
      4,
      5
    ],
    "aSelection": {
      "triggerId": "lte:4",
      "effects": [
        {
          "effectId": "grant-status",
          "targetId": "self",
          "statusId": "tailwind",
          "options": {
            "amount": "amount-2"
          }
        }
      ]
    },
    "cSelection": {
      "mode": "special",
      "structure": {
        "kind": "flat",
        "effects": [
          {
            "effectId": "revive",
            "targetId": "self",
            "options": {
              "maxHpPct": "revivePct-0.1"
            }
          },
          {
            "effectId": "turn-damage",
            "targetId": "enemy",
            "options": {
              "baseAmount": "stepBaseAmount-30",
              "everyTurns": "stepEveryTurns-5",
              "stepAmount": "stepAmount-10"
            }
          }
        ]
      }
    }
  },
  {
    "id": "heal",
    "label": "ヒール",
    "description": "出目3で清潔を2付与。CでHPを30回復し、3ターンの命中時集中オーラで攻撃も補います。",
    "stats": {
      "AT": 2,
      "DF": 4,
      "SP": 3
    },
    "diceFrame": "custom-speed",
    "dice": [
      2,
      3,
      3,
      3,
      0,
      0
    ],
    "aSelection": {
      "triggerId": "exact:3",
      "effects": [
        {
          "effectId": "grant-status",
          "targetId": "self",
          "statusId": "clean",
          "options": {
            "amount": "amount-2"
          }
        }
      ]
    },
    "cSelection": {
      "mode": "normal",
      "structure": {
        "kind": "flat",
        "effects": [
          {
            "effectId": "heal",
            "targetId": "self",
            "options": {
              "amount": "healAmount-30"
            }
          },
          {
            "effectId": "grant-on-hit",
            "targetId": "self",
            "statusId": "focus",
            "options": {
              "amount": "timedStacks-1",
              "duration": "timedTurns-3"
            }
          }
        ]
      }
    }
  },
  {
    "id": "technical",
    "label": "テクニカル",
    "description": "出目2でランダムな状態異常を2付与。Cは状態異常と状態数ダメージ、または集中オーラとDF低下の2分岐です。",
    "stats": {
      "AT": 2,
      "DF": 5,
      "SP": 2
    },
    "diceFrame": "custom-normal",
    "dice": [
      2,
      2,
      2,
      5,
      0,
      0
    ],
    "aSelection": {
      "triggerId": "exact:2",
      "effects": [
        {
          "effectId": "grant-status",
          "targetId": "enemy",
          "statusId": "@debuff",
          "options": {
            "amount": "amount-2"
          }
        }
      ]
    },
    "cSelection": {
      "mode": "normal",
      "structure": {
        "kind": "random",
        "branches": [
          {
            "effects": [
              {
                "effectId": "grant-status",
                "targetId": "enemy",
                "statusId": "random-debuff",
                "options": {
                  "amount": "statusStacks-3"
                }
              },
              {
                "effectId": "status-damage",
                "targetId": "enemy",
                "options": {
                  "multiplier": "statusMultiplier-15"
                }
              }
            ]
          },
          {
            "effects": [
              {
                "effectId": "grant-on-hit",
                "targetId": "self",
                "statusId": "focus",
                "options": {
                  "amount": "timedStacks-1",
                  "duration": "timedTurns-3"
                }
              },
              {
                "effectId": "change-df",
                "targetId": "enemy",
                "options": {
                  "direction": "decrease",
                  "amount": "turnDFAmount-3",
                  "duration": "turnCount-3"
                }
              }
            ]
          }
        ]
      }
    }
  }
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
