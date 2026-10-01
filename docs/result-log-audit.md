# 戦闘結果ログの移行監査

参照: `base` (`daa3772`) の `js/result.js`。対象: `main` (`f1fed4b`) の
`resultBlocks.js` と、現在の `battleEngine.js` / `effects.js` / `ruleEngine.js` /
`bPassiveModifiers.js` が発行するイベント。base とエンジン・保存仕様は変更しない。

## 復元した表示

| 現在のイベント/code | 復元内容 |
| --- | --- |
| roughWaveResult / steamResult / headwindResult | 状態専用見出し、成否の文言、stock消費の補足 |
| ACTION_CANCELED_ROUGH_WAVE / ACTION_CANCELED_HEADWIND | 行動不能とAスキル阻害の理由を区別 |
| STATUS_CRACK_DAMAGE + statusDamage | 通知で見出し、実ダメージで効果文言を表示。ダメージ行は一度だけ |
| STATUS_CLEAN_CONSUMED | 清潔の見出し、防御文言、防いだ状態・量、清潔stock減少 |
| STATUS_FOCUS_CONSUMED | 集中の見出し、倍率、stock消費。ATTACK_DAMAGE_MUL_FOCUSは重複抑制 |
| ATTACK_AVOIDED_BY_TAILWIND | 追風の見出し、回避文言、stock変化 |
| counterTriggered / counterDamage | 反撃の見出しを維持し「ダメージを返した」とstock補足を表示 |
| statusChange | 変化なしの文言、自然減衰のmeta表示。発動時全消費は専用結果行に集約 |
| attackChanged | miss / mulDamage / addDamage / setDamage / その他の専用文言 |
| valueChanged | tempDfPlus / nextAttackATPlus / attackTimesAdd / attackTimesOverride / recoilMinusの文言。上書きのnullは「通常」、軽減量はダメージ増減と符号を反転 |
| passiveSkillStateChanged | Battler名の見出しを維持。発動時のDuckへの効果・HP割合と解除時の文言を復元。独自スキル名は維持 |
| NEXT_ATTACK_ATPLUS_CONSUMED | 次回攻撃ATの消費量 |
| ATTACK_MISSED_BY_EFFECT | 「攻撃できない」。連続行動の命中失敗「攻撃を外した」と区別 |
| buffApplied / buffTick / buffExpired | 持続期間、残りターンと終了表示。現在のphase durationは行動中と明示 |
| heal | 回復量0も表示。ダイス由来なら🎲を維持 |
| battleStart / turnStart | 4フィールドの説明、氷風呂・電気風呂のターン開始表示 |
| note | 構造化codeの診断表示と未対応effect.type表示。自由文は使用しない |

## 復元した配置

- ダイス結果直前、スキルgroup / フィールドgroupの終了にspacer。連続spacerは抑制する。
- groupIdとfield sourceに基づいて効果群をインデントする。台詞も同じgroup内に保つ。
- 初回phase前の常時Bを最初の攻撃ブロック冒頭へ移す。初回phaseがない記録でも捨てない。
- buffTick / buffExpiredをターン末尾のsystemブロックへ集約する。
  phase終了のbuffExpiredも表示だけを保留し、後続の攻撃フェイズを壊さない。
- beforeTurnEnd Cと同一groupIdの効果・台詞を末尾へまとめる。
  現行mainのbeforeTurnEnd / turnEndのB等も同じ末尾領域へ配置する。
- turnEndがない途中記録でも次turnStart / battleEnd / 記録末尾で保留行を排出する。
- 状態の適用はイベント発生順。表示を移しても、末尾の回復を攻撃ブロックのHPへ先取りしない。

## 復元しない旧処理・維持するmain仕様

- 固定キャラクターデータ、固定画像パス、旧iconKeyからの表示取得:
  mainの保存済みpresentation snapshotと独自スキル名を維持する。
- statusEffect.textなど古い自由文・未使用のstatusEffect heal形式:
  現在のengineは発行しないため復活させない。
- 未知フィールドの「説明は未設定」ダミー文: 現在の実フィールド4種のみ説明する。
- 集中の攻撃倍率行、発動全消費の汎用解除行、亀裂の重複ダメージ:
  専用演出と実ダメージ行に集約する。accuracyRollの非表示はbase同様に維持する。
- 復活をHPなしの旧文言に戻す処理: mainの復活後HP表示を維持する。
- バフをすべて旧turnsとして扱う処理: 現在のphase / turnsの区別を維持する。
- randomPick等、baseにも専用表示がなくmainで無表示の内部イベントは対象外。
- randomStatusGrantFailed、🎲の構造化判定、ランダム付与候補除外は前回修正を維持する。

## 検証

`resultLogRestoration.test.mjs` は専用文言、stock、倍率、group区切り、ターン末尾配置、
途中記録の保留排出、HP/AP、イベント非破壊、実engineイベントを検証する。
`battleLogFixes.test.mjs` はspacerを除いた内容行で前回の回帰テストを継続する。
既存のpresentation / 保存 / 戦闘ルールのテストも全件実行する。
