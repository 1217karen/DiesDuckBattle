import { finishPageLoad } from "./pageLoad.js";
import { notices } from "./noticeData.js";

// Shared static data drives both articles and the index in its authored order.
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const articles = document.getElementById("notice-articles");
const noticeIndex = document.getElementById("notice-index");

for (const notice of notices) {
  const article = element("article", "notice-article page-panel");
  article.id = notice.id;
  const title = element("h2", "", notice.title);
  title.id = notice.id + "-title";
  article.setAttribute("aria-labelledby", title.id);

  const meta = element("div", "notice-meta");
  const date = element("time", "", notice.date.replaceAll("-", "/"));
  date.dateTime = notice.date;
  meta.append(element("span", "notice-badge", notice.category), date);

  const body = element("div", "notice-body");
  for (const paragraph of notice.body) body.append(element("p", "", paragraph));
  article.append(meta, title, body);
  articles.append(article);

  const link = element("a");
  link.setAttribute("href", "#" + encodeURIComponent(notice.id));
  const shortDate = element("time", "", notice.date.slice(5).replace("-", "/"));
  shortDate.dateTime = notice.date;
  link.append(shortDate, element("span", "", notice.title));
  noticeIndex.append(link);
}

// Reports remain a fixed mock; only tabs and article anchors are interactive.
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
  let id;
  try { id = decodeURIComponent(location.hash.slice(1)); }
  catch { return; }
  const article = document.getElementById(id);
  if (!article?.matches(".notice-article")) return;
  activate(0);
  article.scrollIntoView();
}
window.addEventListener("hashchange", revealArticle);
activate(0);
finishPageLoad();
revealArticle();