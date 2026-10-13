import { renderProfileBattleCard } from './profileBattleCard.js';
import { FIXED_IMAGES, setImageWithFallback } from "./fixedImages.js";
import { renderQuoteRichText } from "./quoteRichText.js";
import { presentProfileSkill } from "./profileSkillPresentation.js";

const labels = { default: ["AT", "DF", "SP"], kanji: ["攻撃", "防御", "速度"], english: ["Attack", "Defense", "Speed"], hiragana: ["つよさ", "かたさ", "はやさ"] };
const types = { attack: "アタック", defense: "ディフェンス", speed: "スピード", heal: "ヒール", technical: "テクニカル", normal: "ノーマル" };
export function profileStatLevel(key, value) {
  if (value === null || !Number.isFinite(value)) return 0;
  return key === "SP" ? ({ 1: 1, 2: 3, 3: 5 }[value] ?? 0) : Math.max(0, Math.min(5, value));
}

/** Build off-screen; the page only installs the complete view after success. */
export function renderProfile(document, profile) {
  const el = (tag, className = "", text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const image = (url, fallback, className, alt) => {
    const img = el("img", className); img.alt = alt;
    setImageWithFallback(img, url, fallback); return img;
  };
  const card = (className, title) => {
    const node = el("section", `profile-card ${className}`);
    if (title) node.append(el("h2", "", title));
    return node;
  };
  const rich = text => {
    const node = el("div", "profile-rich-text");
    node.innerHTML = renderQuoteRichText(text);
    return node;
  };
  const profileText = text => text === "" ? el("p", "profile-empty", "プロフィールが設定されていません") : rich(text);
  const skillList = skills => {
    const list = el("div", "skill-list");
    for (const [category, { selection, label }] of Object.entries(skills)) {
      const skill = el("section", `skill-card skill-${category}`);
      skill.append(el("div", "skill-category", `${category} SKILL`));
      if (label.name) {
        const name = el("h3", "skill-name");
        if (label.ruby) { const ruby = el("ruby", "", label.name); ruby.append(el("rt", "", label.ruby)); name.append(ruby); }
        else name.textContent = label.name;
        skill.append(name);
      }
      skill.append(el("p", "skill-effect", presentProfileSkill(category, selection))); list.append(skill);
    }
    return list;
  };
  const row = (label, level, empty = false) => {
    const node = el("div", "stat-row"), track = el("div", "stat-track"), fill = el("div", "stat-fill");
    track.setAttribute("role", "img"); track.setAttribute("aria-label", `${label || "フレーバー"}：${empty ? "未設定" : "グラフ"}`);
    fill.style.setProperty("--value", String(level)); track.append(fill);
    node.append(el("span", "stat-label", label), track); return node;
  };
  const fragment = document.createDocumentFragment();
  const header = el("header", "profile-header"); header.append(el("h1", "", `ENo.${profile.eno} / ${profile.battler.name}`));
  const grid = el("div", "profile-grid"), b = profile.battler;
  const battler = card("battler-card"), visual = el("div", "battler-visual"), standing = el("div", "battler-standing-wrap");
  standing.append(image(b.standingImageUrl, FIXED_IMAGES.battlerStanding, "battler-standing", "Battler立ち絵")); visual.append(standing);
  const rail = el("div", "profile-icon-rail");
  const positionIcons = () => {
    let position = 0;
    for (const img of rail.children) {
      if (img.hidden) continue;
      img.setAttribute("data-icon-position", String(++position));
      img.style.setProperty("--icon-position", String(position));
    }
  };
  rail.append(image(b.defaultIconUrl, FIXED_IMAGES.battlerIcon, "", "Battlerアイコン"));
  for (const { url } of b.profileIcons) {
    if (!url.trim()) continue;
    const img = el("img"); img.alt = "プロフィールアイコン";
    img.addEventListener("error", () => { img.hidden = true; positionIcons(); }, { once: true }); img.src = url;
    rail.append(img);
  }
  positionIcons();
  visual.append(rail);
  if (b.profile.message !== "") battler.append(el("p", `profile-message${b.profile.messageTail ? " has-tail" : ""}`, b.profile.message));
  battler.append(visual, skillList({ B: b.skills.B, D: b.skills.D }));
  const text = card("profile-text-card", "BATTLER PROFILE"); text.append(profileText(b.profile.text));
  const duck = card("duck-card", "MY DUCK"), d = profile.duck;
  if (!d) duck.append(el("p", "profile-empty", "未登録 — 公開Duckは設定されていません"));
  else {
    const heading = el("div", "duck-heading");
    heading.append(image(d.iconUrl, FIXED_IMAGES.duckIcon, "duck-icon", "Duckアイコン"), el("h3", "duck-name", d.name));
    duck.append(heading, el("p", "duck-meta", `${types[d.profile.type] ? `${types[d.profile.type]}タイプ` : "タイプ：未設定"} / 属性：${d.profile.attributes.filter(Boolean).join("・") || "未設定"}`), skillList({ A: d.skills.A, C: d.skills.C }));
    const stats = el("div", "stat-section"); stats.setAttribute("aria-label", "ステータス");
    stats.append(el("h3", "profile-section-heading", "STATUS"));
    ["AT", "DF", "SP"].forEach((key, i) => stats.append(row(labels[d.profile.statLabelPreset][i], profileStatLevel(key, d.stats[key]), d.stats[key] === null)));
    if (d.profile.flavorStats.length) {
      const flavor = el("div", "stat-flavor");
      d.profile.flavorStats.forEach(s => flavor.append(row(s.label, s.value))); stats.append(flavor);
    }
    const text = el("div", "duck-profile"); text.append(el("h3", "profile-section-heading", "DUCK PROFILE"), profileText(d.profile.text)); duck.append(stats, text);
  }
  const favorite = renderFeaturedBattle(document, profile);
  grid.append(battler, text, duck, favorite); fragment.append(header, grid); return fragment;
}

/** Public projection only; shared by the initial page and the owner's post-save refresh. */
export function renderFeaturedBattle(document, profile) {
  const el = (tag, className = "", text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const favorite = el("section", "profile-card featured-battle"), battle = profile.featuredBattle;
  favorite.append(el("h2", "", "FAVORITE BATTLE"));
  if (!battle) favorite.append(el("p", "profile-empty", "お気に入りバトルは設定されていません"));
  else {
    const link = el("a", "featured-summary"); link.href = `result.html?battleId=${encodeURIComponent(battle.battleId)}`;
    link.append(renderProfileBattleCard(document, battle)); favorite.append(link);
  }
  return favorite;
}
