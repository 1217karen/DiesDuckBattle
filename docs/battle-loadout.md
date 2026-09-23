# Production battle loadout

`js/battleLoadoutCompiler.js` は保存済みv1モデルを読み取り、現在のproduction compilerでengine入力を生成するpure moduleです。storage/UIへのアクセスや戦闘開始は行いません。

```js
const inspection = inspectBattleLoadout(build, duckId);
// { ready, invalid, incomplete }

const result = compileBattleLoadout(build, {
  duckId,
  battlerId: "player-1",
  battlerName: "プレイヤー",
});
// success: { ok: true, battler, duck }
// failure: { ok: false, inspection }
```

検査対象をBattlerと選択Duckへ絞ってから`inspectBuildForSave()`を再利用します。未完成・不正がない場合だけreadyです。他Duckの未完成・不正は影響しません。存在しないID・選択IDの重複は明示的なinvalidになります。issueのsection/duckId/ownerName/code/path/messageは将来の選択UIでも使用できます。名前が空のDuckは元の配列位置による「アヒル N」で識別します。

Battler IDは空でない文字列、名前は文字列を呼び出し側で渡します。空の名前は許容します。builderはIDを生成しません。

出力は以下のフィールドだけです。

- Battler: `id`, `name`, `bSkills`, `dSkill`
- Duck: `id`, `name`, `stats: { AT, DF, SP }`, `dice`, `aSkill`, `cSkill`

B/Dは既存compilerのbSkills/skill、A/Cは既存compilerのskillに固定表示metadata（`A_PLAYER` / `C_PLAYER`、`Aスキル` / `Cスキル`）を付けます。Duck IDと名前は保存値を維持します。maxHPは生成せずengineに計算を任せます。selection、diceFrame、resourceやinspection結果はengineデータに含めません。

入力の複製をcompilerへ渡すため編集stateと出力は独立しています。compile結果やreadinessは保存モデルへ書き戻しません。compilerが検査通過後にも拒否した場合は`COMPILATION_FAILED`で生成を中止します。

`node --test tests/battleLoadoutCompiler.test.mjs` で検査・生成・独立性と、2人分を既存runBattleへ渡す契約smoke testを実行できます。0のダイス面は既存仕様上合法な空き枠であり、それだけでは未完成になりません。
