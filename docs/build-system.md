# 作成設定と戦闘処理の境界

`buildRules.js` はゲームの作成制限、`skillCatalog.js` は現在公開する選択肢、
`buildValidator.js` はユーザー作成DTOの検査を担当する。戦闘側からはimportしない。
既存4ファイルは変更しない。戦闘中のAP消費、Cスキル、状態変化も従来どおり。

## 作成DTO v1

```js
const build = {
  schemaVersion: 1,
  diceFrame: "light",
  stats: { AT: 1, DF: 1 },
  dice: [0, 0, 0, 0, 0, 0],
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

`diceFrames.js` の信頼済み定義からSPと使用可能な非0出目を参照する。
lightはSP3・1～4、basicはSP2・2～5、heavyはSP1・3～6。
ユーザーDTOのstats.SPは受け付けない。
ダイスは6枠。0は全素体で利用できる未装着の空き枠で、個数制限はない。
非0の同一出目は通常2個まで、0が1個以上あれば3個まで。
AT + DF + 導出SPの合計上限は9。
AT/DFはそれぞれ1～5。合計9まで使い切る必要はない。
A/B/C/Dの個数/予算/価格算定/作成条件はTODO（null）。nullは無制限ではない。
整数型はDTOの形式要件。
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
SPも `getDiceFrame(build.diceFrame).SP` から生成する。ユーザーDTOには書き戻さない。
0の空き枠は将来のcompilerでも「振られる出目0」として残す。削除・抽選対象外化はしない。
将来Aスキルの出目0条件に使える前提だが、今回は公開項目や既存エンジンの出目0の挙動を変更しない。
カタログ登録だけではコンパイル実装済みを意味しない。変換未対応IDはコンパイラが拒否する。
ユーザー入力をspreadして内部effectへ渡すことは禁止。triggerIdも任意文字列として転送しない。
Aの出目条件、Bのイベント/常時バフ、Cの独立処理、DのbattleStartの違いを変換側で扱う。
現行ruleEngineのcompileAllRulesForFighterは戦闘実行用rulesへの変換であり、
ユーザーDTO用buildCompilerとは別の責務。

legacyAdapterは旧版の対応効果を保持し、ユーザー公開カタログを通して制限しない。
旧版の変換作業もmain上で行い、保存用baseブランチ自体は編集しない。
将来、battler/duckに依存しない内部形式を導入するときは両変換器の出力を同時に移行する。

## 作成資源

`calculateBuildResources(build, rules)`（buildResources.js）は純粋関数。
同じ結果を `validateBuild(...).resources` からも取得できる。

```js
{
  stats: { sp: 1, used: 3, remaining: 6 },
  dice: { emptyCount: 3, tripleCount: 1, earned: 3, spent: 1, remaining: 2 }
}
```

ステータス未使用分は `totalMax - (AT + DF + SP)`。将来のC用資源であり、
ダイス由来資源とは合算しない。ダイスは0一枠につき1pt、非0出目の3個積み一種類につき1pt消費。
4個以上も計算上は一種類と数えるが、validatorは個数違反として拒否する。
計算不能な欄はnull、負の残高は補正せず返す。計算結果だけで合法とは判断せずvalidを確認する。
スキルルールは引き続き未確定なので、validでもreadyとは限らない。

単価はbuildRulesのresourcesに集約。`aUpgradeDicePointCost: 2` は基本案の設定のみ。
`cModules` は運営側の `モジュールID -> { statPointCost }` 価格表の拡張口で、現在は空。
将来のC構築処理はここから個別価格を取得し、未登録IDを拒否し、stats.remaining内で消費を検証する。
ユーザーからのcost申告は受け付けない。今回Cモジュール選択DTO・価格計算処理・具体的価格は実装しない。

## テスト実行

Node.js 22以降で `node --test tests/*.test.mjs`。
テスト内の数値・公開IDは検査用fixtureであり、ゲーム仕様の決定ではない。
