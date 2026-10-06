// Classic head script: stay light until the shared Auth controller confirms login.
(() => {
  const key = "diesduck-site-theme";
  let loggedIn = false;
  const normalize = value => value === "dark" ? "dark" : "light";
  const read = () => {
    try { return normalize(globalThis.localStorage.getItem(key)); }
    catch { return "light"; }
  };
  const apply = value => {
    const theme = loggedIn ? normalize(value) : "light";
    document.documentElement.dataset.theme = theme;
    return theme;
  };
  const set = value => {
    const theme = normalize(value);
    try { globalThis.localStorage.setItem(key, theme); } catch { /* Preference still works for this page. */ }
    return apply(theme);
  };
  const bindAuth = controller => controller.subscribe(state => {
    const confirmedLogin = state.sessionKnown === true && state.signedIn === true;
    if (confirmedLogin === loggedIn) return;
    loggedIn = confirmedLogin;
    apply(loggedIn ? read() : "light");
  });
  globalThis.diesDuckSiteTheme = { read, apply, set, bindAuth };
  apply("light");
})();
