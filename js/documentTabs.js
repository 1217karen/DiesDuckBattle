export function mountDocumentTabs({ names, document = globalThis.document, window = globalThis.window }) {
  const tabs = names.map(name => document.getElementById("tab-" + name));
  const panels = names.map(name => document.getElementById("panel-" + name));
  const render = () => {
    const hash = window.location.hash.slice(1);
    // Section anchors retain their own hash so history also restores the correct panel.
    const section = document.getElementById(hash);
    let active = names.indexOf(hash);
    if (active < 0 && section) active = panels.findIndex(panel => panel.contains(section));
    if (active < 0) active = 0;
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === active));
      tab.tabIndex = i === active ? 0 : -1;
      panels[i].hidden = i !== active;
    });
    if (section && panels[active].contains(section)) section.scrollIntoView();
  };
  const activate = i => {
    window.location.hash = "#" + names[i];
    render();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => activate(i));
    tab.addEventListener("keydown", event => {
      let target;
      if (event.key === "ArrowRight") target = (i + 1) % tabs.length;
      else if (event.key === "ArrowLeft") target = (i + tabs.length - 1) % tabs.length;
      else if (event.key === "Home") target = 0;
      else if (event.key === "End") target = tabs.length - 1;
      else return;
      event.preventDefault();
      activate(target);
      tabs[target].focus();
    });
  });
  window.addEventListener("hashchange", render);
  render();

}

