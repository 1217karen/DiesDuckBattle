export const gameMenuItems = Object.freeze([
  { label: "ホーム", href: "index.html" },
  { label: "キャラクター選択", href: "select.html", login: true },
  { label: "戦闘設定", href: "setting.html", login: true },
  { label: "表示設定", href: "character.html", login: true },
  { label: "バトル履歴", href: "storage.html" },
  { label: "ルールブック（未実装）" },
  { label: "キャラリスト（未実装）" },
]);
export function menuModel(state) {
  const loggedIn = state.sessionKnown && state.signedIn;
  let identity = state.ready ? "ログイン状態を確認できません" : "ログイン状態を確認中…";
  if (state.sessionKnown) {
    if (!state.signedIn) identity = "未ログイン";
    else if (state.accounts.length === 1) {
      const account = state.accounts[0];
      identity = "ENo." + account.eno + "｜" + (account.name?.trim() ? account.name : "キャラ名を取得できません");
    } else if (state.accounts.length > 1) identity = "複数ENo：" + state.enos.map(eno => "ENo." + eno).join(" / ") + "｜切り替えは今後実装";
    else identity = "ログイン中｜" + state.sessionMessage;
  }
  return { identity, loggedIn, items: gameMenuItems.filter(item => !item.login || loggedIn) };
}
