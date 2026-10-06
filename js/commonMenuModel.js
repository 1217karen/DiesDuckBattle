export const gameMenuItems = Object.freeze([
  { label: "ホーム", href: "index.html" },
  { label: "キャラクター選択", href: "select.html", login: true },
  { label: "戦闘設定", href: "setting.html", login: true },
  { label: "表示設定", href: "character.html", login: true },
  { label: "バトル履歴", href: "storage.html" },
  { label: "ルールブック", href: "rulebook.html" },
  { label: "キャラリスト", href: "character-list.html", login: true },
]);
export function menuModel(state) {
  const loggedIn = state.sessionKnown && state.signedIn;
  let identity = state.ready ? "ログイン状態を確認できません" : "";
  if (state.sessionKnown) {
    if (!state.signedIn) identity = "未ログイン";
    else if (state.accounts.length === 1) {
      const account = state.accounts[0];
      identity = "ENo." + account.eno + "｜" + (account.name?.trim() ? account.name : "キャラ名を取得できません");
    } else if (state.accounts.length > 1) identity = "複数ENo：" + state.enos.map(eno => "ENo." + eno).join(" / ") + "｜切り替えは今後実装";
    else identity = "ログイン中｜" + state.sessionMessage;
  }
  // Only confirmed account data may identify an owner profile. Display cache is not account selection.
  const currentAccount = loggedIn && state.accountsResolved !== false && state.accounts.length === 1
    && /^[1-9]\d*$/.test(String(state.accounts[0].eno)) ? state.accounts[0] : null;
  return { identity, loggedIn, currentAccount, items: gameMenuItems.filter(item => !item.login || loggedIn) };
}
