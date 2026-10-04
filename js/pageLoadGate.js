// Parser-time bootstrap: the HTML/CSS already hides content before this script runs.
// No Auth/cache decisions here. The page's existing guard still owns admission.
(() => {
  const body = document.body;
  let finished = false, indicator = null;
  const timer = setTimeout(() => {
    if (finished || body.classList.contains("auth-required-pending")) return;
    indicator = document.createElement("p");
    indicator.className = "page-load-indicator";
    indicator.setAttribute("role", "status");
    body.append(indicator);
    indicator.textContent = "読み込み中……";
  }, 1000);
  const finish = () => {
    if (finished) return;
    clearTimeout(timer);
    indicator?.remove();
    indicator = null;
    // Redirecting private pages stay concealed, even if an in-flight load settles.
    if (body.classList.contains("auth-required-pending")) return;
    finished = true;
    body.classList.remove("page-loading");
  };
  const fail = (message = "ページを読み込めませんでした。通信状況を確認し、再読み込みしてください。") => {
    if (finished || body.classList.contains("auth-required-pending")) return;
    // Do not expose half-built controls after an unexpected exception/module failure.
    body.classList.add("page-load-failed");
    const error = document.createElement("p");
    error.className = "page-load-error";
    error.setAttribute("role", "alert");
    error.textContent = message;
    body.append(error);
    finish();
  };
  globalThis.diesDuckPageLoad = { finish, fail };
})();
