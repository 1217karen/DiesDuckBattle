// Classic head script: apply the browser preference before styles load.
(() => {
  const key = "diesduck-site-theme";
  const normalize = value => value === "dark" ? "dark" : "light";
  const read = () => {
    try { return normalize(globalThis.localStorage.getItem(key)); }
    catch { return "light"; }
  };
  const apply = value => {
    const theme = normalize(value);
    document.documentElement.dataset.theme = theme;
    return theme;
  };
  const set = value => {
    const theme = apply(value);
    try { globalThis.localStorage.setItem(key, theme); } catch { /* Preference still works for this page. */ }
    return theme;
  };
  globalThis.diesDuckSiteTheme = { read, apply, set };
  apply(read());
})();
