import { finishPageLoad } from "./pageLoad.js";

// Only presentation is interactive. All articles, counts and statuses are static HTML.
const tabs = [...document.querySelectorAll('.notice-tabs [role="tab"]')];
const panels = tabs.map(tab => document.getElementById(tab.getAttribute("aria-controls")));

function activate(index) {
  tabs.forEach((tab, i) => {
    tab.setAttribute("aria-selected", String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
    panels[i].hidden = i !== index;
  });
}

tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => activate(i));
  tab.addEventListener("keydown", event => {
    let index;
    if (event.key === "ArrowRight") index = (i + 1) % tabs.length;
    else if (event.key === "ArrowLeft") index = (i + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = tabs.length - 1;
    else return;
    event.preventDefault();
    activate(index);
    tabs[index].focus();
  });
});

function revealArticle() {
  const article = document.getElementById(location.hash.slice(1));
  if (!article?.matches(".notice-article")) return;
  activate(0);
  article.scrollIntoView();
}
window.addEventListener("hashchange", revealArticle);
activate(0);
finishPageLoad();
revealArticle();