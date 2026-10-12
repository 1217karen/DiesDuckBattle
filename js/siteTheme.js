// Classic head script: apply this browser's preference synchronously before CSS.
(() => {
  if (globalThis.diesDuckSiteTheme) return;
  // Only pages opting in with the classic head script receive page colors.
  const themedPage = !!document.querySelector('script[src="js/siteTheme.js"]');
  const key = "diesduck-site-theme";
  const normalize = value => value === "dark" ? "dark" : "light";
  const read = () => {
    try { return normalize(globalThis.localStorage.getItem(key)); }
    catch { return "light"; }
  };
  const apply = value => {
    const theme = normalize(value);
    if (themedPage) document.documentElement.dataset.theme = theme;
    return theme;
  };
  const set = value => {
    const theme = normalize(value);
    try { globalThis.localStorage.setItem(key, theme); } catch { /* Preference still works for this page. */ }
    return apply(theme);
  };
  globalThis.diesDuckSiteTheme = { read, apply, set };
  apply(read());
})();
