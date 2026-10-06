// Shared static markup for the standalone page and INDEX dialog.
export const authMarkup = `  <section class="panel" aria-labelledby="session-title">
    <h2 id="session-title">ログイン状態</h2>
    <p id="session-message" role="status">認証機能を読み込み中…</p>
    <p id="current-eno" class="eno" hidden></p>
    <ul id="account-list" hidden></ul>
    <button id="logout" type="button" hidden>ログアウト</button>
  </section>
  <section id="registered" class="panel success" hidden tabindex="-1" aria-labelledby="registered-title">
    <h2 id="registered-title">登録が完了しました</h2>
    <p>あなたのENo</p><p id="registered-eno" class="eno"></p>
    <p>このENoとパスワードがログインに必要です。ENoを控えてください。</p>
    <button id="copy-eno" type="button">ENoをコピー</button>
    <button id="go-login" type="button">このENoでログインへ</button>
    <p id="copy-status" role="status"></p>
  </section>
  <section class="panel" aria-label="認証フォーム">
    <div class="switch" aria-label="フォーム切り替え">
      <button id="show-register" type="button" aria-pressed="true" aria-controls="register-form">新規登録</button>
      <button id="show-login" type="button" aria-pressed="false" aria-controls="login-form">ログイン</button>
    </div>
    <p id="form-message" role="status" aria-live="polite"></p>
    <form id="register-form" method="post">
      <fieldset disabled><legend>新しいゲームアカウント</legend>
        <label for="character-name">バトラー名</label>
        <input id="character-name" type="text" placeholder="バトラー名を入力" aria-describedby="character-name-error" autocomplete="nickname" required>
        <p id="character-name-error" role="status"></p>
        <label for="register-password">パスワード</label>
        <p id="register-password-hint" class="hint">パスワードは6文字以上、半角英字と数字をそれぞれ1文字以上含めてください。</p>
        <input aria-describedby="register-password-hint" id="register-password" type="password" autocomplete="new-password" required>
        <label for="confirm-password">パスワード確認</label>
        <input id="confirm-password" type="password" autocomplete="new-password" required>
        <p class="hint">バトラー名は後から変更できます。メールアドレスは不要です。</p>
        <button type="submit">登録する</button>
      </fieldset>
    </form>
    <form id="login-form" method="post" hidden>
      <fieldset disabled><legend>ENoでログイン</legend>
        <label for="login-eno">ENo</label>
        <input id="login-eno" type="text" inputmode="numeric" autocomplete="username" required>
        <label for="login-password">パスワード</label>
        <input id="login-password" type="password" autocomplete="current-password" required>
        <button type="submit">ログインする</button>
      </fieldset>
    </form>
  </section>
`;
