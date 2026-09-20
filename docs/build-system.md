# 作成設定と戦闘処理の境界

`buildRules.js` はゲームの作成制限、`skillCatalog.js` は現在公開する選択肢、
`buildValidator.js` はユーザー作成DTOの検査を担当する。戦闘側からはimportしない。
既存4ファイルは変更しない。戦闘中のAP消費、Cスキル、状態変化も従来どおり。

## 作成DTO v1

```js
const build = {
  schemaVersion: 1,
  stats: { AT: 1, DF: 1, SP: 1 },
  dice: [1, 2, 3, 4, 5, 6],
  skills: [],
};
const result = validateBuild(build); // import from js/buildValidator.js
// result.valid: 現在確定済みの検査で違反がない
// result.complete: 未確定の検査がない
// result.ready: 両方true（将来の登録・コンパイルの必要条件）
// errors / pending: { code, path, message }[]
```

スキルの入力は `{ category, triggerId, effectIds }`。生のeffect、when、costAP、
任意パラメータなどは受け付けない。選択IDと内部effect.typeは別の名前空間。
数値入力を公開するときは、パラメータ専用schemaと検証を追加する。

確定しているダイス6枠のみ設定済み。上下限・合計上限・SP別出目・重複数・
A/B/C/Dの個数/予算/価格算定/作成条件はTODO（null）。nullは無制限ではない。
整数型はDTOの形式要件であり、具体的なゲーム上の範囲はルール確定後に設定する。
カタログの公開リストも未確定なので空。未登録IDは拒否するがエンジン機能は削除しない。

`createBuildRules()` / `createSkillCatalog()` は毎回独立した設定を返す。
運営側で全ルールを設定して `validateBuild(build, { rules, catalog })` に渡す。
部分設定の自動マージはしない。ルール・カタログはユーザー入力から受け取らない。
カテゴリごとの `costOf(skill, build)` は作成予算用の価格を算出し、
`validate(skill, build)` は追加の作成制限に違反する理由の文字列配列を返す。
コールバックは純粋関数として実装する。戦闘時の発動条件はここでは実行しない。
不正な運営側設定/コールバック結果は設定ミスとして例外になる。

## 将来の接続契約（この変更では未実装）

```text
旧版 battler + duck → legacyAdapter ──────────────────┐
                                                    ↓
ユーザーDTO → validateBuild → buildCompiler → 共通の戦闘用データ → runBattle
                 ready必須
```

最初の接続段階では共通の戦闘用データを現在のrunBattle引数の
`{ p1, p2, data: { BATTLERS, DUCKS } }` に合わせれば、エンジン変更なしで接続できる。
両変換器がこの同じ契約を返し、ID参照の整合性と出力の独立性を保証する。
runBattleの `rng / maxTurns / field` は実行オプションとして呼び出し側が別に渡す。

buildCompilerは検証後に、登録IDを信頼済みの変換定義へ解決し、新しい内部データを生成する。
カタログ登録だけではコンパイル実装済みを意味しない。変換未対応IDはコンパイラが拒否する。
ユーザー入力をspreadして内部effectへ渡すことは禁止。triggerIdも任意文字列として転送しない。
Aの出目条件、Bのイベント/常時バフ、Cの独立処理、DのbattleStartの違いを変換側で扱う。
現行ruleEngineのcompileAllRulesForFighterは戦闘実行用rulesへの変換であり、
ユーザーDTO用buildCompilerとは別の責務。

legacyAdapterは旧版の対応効果を保持し、ユーザー公開カタログを通して制限しない。
旧版の変換作業もmain上で行い、保存用baseブランチ自体は編集しない。
将来、battler/duckに依存しない内部形式を導入するときは両変換器の出力を同時に移行する。

## 検証

Node.js 22以降で `node --test tests/buildValidator.test.mjs`。
テスト内の数値・公開IDは検査用fixtureであり、ゲーム仕様の決定ではない。
