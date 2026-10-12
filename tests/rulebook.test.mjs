import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { HP_FORMULA, calcMaxHPFromStats } from "../js/statsUtil.js";
import { createBuildRules } from "../js/buildRules.js";
import { DICE_FRAMES } from "../js/diceFrames.js";
import { createASkillCatalog } from "../js/aSkillCatalog.js";
import { createCSkillCatalog } from "../js/cSkillCatalog.js";
import { createCSkillRules } from "../js/cSkillRules.js";
import { IMAGE_LIMITS } from "../js/characterImageValidation.js";
import { mountRulebook } from "../js/rulebookPage.js";
import { gameMenuItems, menuModel } from "../js/commonMenuModel.js";

const html = await readFile(new URL("../rulebook.html", import.meta.url), "utf8");
const ids = ["rule", "flow", "stats", "dice", "skills", "attack", "status"];
const anchorsByPanel = Object.fromEntries(["guide", "battle", "guidelines"].map(name => {
  const start = html.indexOf('<div id="panel-' + name + '"');
  const next = html.indexOf('<div id="panel-', start + 1);
  const panel = html.slice(start, next < 0 ? html.indexOf('<footer>', start) : next);
  return [name, [...panel.matchAll(/<section\b[^>]*\bid="([^"]+)"/g)].map(m => m[1])];
}));
function fixture(hash = "") {
  const elements = new Map(), handlers = {};
  const document = { getElementById: id => elements.get(id) };
  for (const id of ["tab-guide", "tab-battle", "tab-guidelines", "panel-guide", "panel-battle", "panel-guidelines", ...Object.values(anchorsByPanel).flat()]) {
    elements.set(id, { id, attrs: {}, handlers: {}, hidden: false,
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(k, v) { this.handlers[k] = v; },
      focus() { document.focused = this; }, scrollIntoView() { this.scrolled = true; },
      contains(node) { return anchorsByPanel[this.id.replace("panel-", "")]?.includes(node.id) ?? false; },
    });
  }
  const window = { location: { hash }, addEventListener(k, v) { handlers[k] = v; } };
  let finished = 0;
  mountRulebook({ document, window, finish: () => finished++ });
  return { elements, window, handlers, document, finished };
}
for (const [hash, active] of [["", "guide"], ["#guide", "guide"], ["#battle", "battle"], ["#guidelines", "guidelines"], ["#dice", "battle"], ["#guide-start", "guide"], ["#unknown", "guide"]]) {
  test("initial tab for " + (hash || "no hash"), () => {
    const f = fixture(hash);
    for (const name of ["guide", "battle", "guidelines"]) {
      assert.equal(f.elements.get("tab-" + name).attrs["aria-selected"], String(name === active));
      assert.equal(f.elements.get("panel-" + name).hidden, name !== active);
      assert.equal(f.elements.get("tab-" + name).tabIndex, name === active ? 0 : -1);
    }
    assert.equal(f.finished, 1);
  });
}
test("click, hashchange/history and keyboard keep tab state and focus consistent", () => {
  const f = fixture();
  const guide = f.elements.get("tab-guide"), battle = f.elements.get("tab-battle");
  battle.handlers.click(); assert.equal(f.window.location.hash, "#battle");
  assert.equal(battle.attrs["aria-selected"], "true");
  f.window.location.hash = "#guide"; f.handlers.hashchange();
  assert.equal(guide.attrs["aria-selected"], "true");
  let prevented = 0;
  guide.handlers.keydown({ key: "ArrowRight", preventDefault() { prevented++; } });
  assert.equal(f.document.focused, battle); assert.equal(prevented, 1);
  battle.handlers.keydown({ key: "Home", preventDefault() {} }); assert.equal(f.document.focused, guide);
  guide.handlers.keydown({ key: "End", preventDefault() {} }); assert.equal(f.document.focused, f.elements.get("tab-guidelines"));
  battle.handlers.keydown({ key: "ArrowLeft", preventDefault() {} }); assert.equal(f.document.focused, guide);
  f.window.location.hash = "#dice"; f.handlers.hashchange();
  assert.equal(f.elements.get("panel-battle").hidden, false);
  assert.equal(f.elements.get("dice").scrolled, true);
});
const section = id => html.match(new RegExp('<section id="' + id + '"[^>]*>([\\s\\S]*?)</section>'))[1];
const prose = value => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const compact = value => prose(value).replace(/\s+/g, "");

test("all section IDs are unique and table-of-contents links resolve inside their tab", () => {
  const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(allIds).size, allIds.length);
  for (const name of ["guide", "battle", "guidelines"]) {
    assert.match(html, new RegExp('id="tab-' + name + '"[^>]*aria-controls="panel-' + name + '"'));
    assert.match(html, new RegExp('id="panel-' + name + '"[^>]*aria-labelledby="tab-' + name + '"'));
  }
  for (const [name, sectionIds] of [["guide", ["start","characters","setting","display","battle","profile","history"].map(id=>"guide-"+id)], ["battle",ids]]) {
    const start=html.indexOf('<div id="panel-'+name+'"');
    const next=html.indexOf('<div id="panel-',start+1);
    const panel=html.slice(start,next);
    const toc=panel.match(/<nav class="toc"[\s\S]*?<\/nav>/)[0];
    assert.deepEqual([...toc.matchAll(/href="#([^"]+)"/g)].map(m=>m[1]),sectionIds);
    for(const id of sectionIds)assert.ok(panel.includes('id="'+id+'"'),id);
  }
  for(const [,anchor] of html.matchAll(/href="#([^"]+)"/g))assert.ok(allIds.includes(anchor),anchor);
});

test("battle chapters and unchanged credit identities remain present", () => {
  for(const id of ids)assert.ok(prose(section(id)).length>100,id);
  const footer=prose(html.match(/<footer>[\s\S]*?<\/footer>/)[0]);
  for(const text of ['WoodenRabbitWorks(うでらび)','シマナガサレV3','「アヒル島」','非公式二次創作作品',
    '画像・UIデザイン・テキスト：1217karen','プログラム：ChatGPT（OpenAI）を利用して作成',
    'キャラクター原案・デザイン：','各キャラクターの権利は各創作者に帰属します'])assert.ok(footer.includes(text),text);
});

test("HP formula and allocation match production constants without freezing prose", () => {
  const rules=createBuildRules(),stats=compact(section('stats'));
  assert.ok(stats.includes(`${HP_FORMULA.base}+${HP_FORMULA.AT}×AT+${HP_FORMULA.DF}×DF−${-HP_FORMULA.SP}×SP`));
  assert.ok(stats.includes(`合計${rules.stats.totalMax}pt以内`));
  assert.ok(stats.includes(`AT・DFはそれぞれ${rules.stats.AT.min}～${rules.stats.AT.max}`));
  assert.deepEqual(rules.stats.AT,rules.stats.DF);
  assert.equal(calcMaxHPFromStats({AT:3,DF:4,SP:2}),325);
});

test("all five production dice types, SP and fixed/custom faces are documented", () => {
  const dice=section('dice');
  for(const frame of Object.values(DICE_FRAMES)) {
    const line=compact(dice.match(new RegExp('<li><b>'+frame.label+'</b>([\\s\\S]*?)</li>'))[0]);
    assert.ok(line.includes('SP'+frame.SP),frame.id);
    assert.ok(line.includes((frame.editable?frame.faces:frame.dice).join('・')),frame.id);
    if(!frame.editable)assert.ok(line.includes('ptは'+frame.dicePoints),frame.id);
  }
  for(let face=0;face<=6;face++)assert.match(dice,new RegExp('<li><b>'+face+'</b>'));
  const text=compact(dice);
  assert.match(text,/0.*通常攻撃は行/);
  const rules=createBuildRules();assert.ok(text.includes(`初期ダイスは${rules.dice.slots}枠`));
  assert.ok(text.includes(`0自体は最大${rules.dice.maxEmpty}枠`));
  assert.ok(text.includes(`通常${rules.dice.maxSameFace}枠`));
  assert.ok(text.includes(`同じ出目を${rules.dice.maxSameFaceWithEmpty}枠`));
});

test("A and C balance examples track production quantities and costs", () => {
  const text=compact(section('skills')),a=createASkillCatalog(),c=createCSkillCatalog(),rules=createCSkillRules();
  assert.ok(text.includes(`基本${a.basePoints}pt`));assert.ok(text.includes(`通常の効果は1～${a.maxEffects}個`));
  const heals=a.effects.find(e=>e.id==='heal-self').amountOptions;
  assert.ok(text.includes(heals.map(o=>o.value).join('・')+'回復で'+heals.map(o=>o.pointCost).join('・')+'pt'));
  const damage=a.effects.find(e=>e.id==='damage-enemy').amountOptions;
  for(const o of damage)assert.ok(text.includes(`${o.value}ダメージで${o.pointCost}pt`));
  assert.ok(text.includes(`基礎${rules.baseAP}AP`));assert.ok(text.includes(`最低でも${rules.minimumAP}AP`));
  assert.ok(text.includes(`全体で1～${rules.maxEffects}個`));assert.ok(text.includes(`減算は最大${rules.maxDrawbackAP}AP`));
  const max=c.optionSets.damageAmount.at(-1);
  assert.ok(text.includes(`${max.value}ダメージだけなら必要${rules.baseAP+max.apDelta}AP`));
  assert.ok(text.includes(c.optionSets.currentHpPct.map(o=>o.value*100).join('・')+'%で追加'+c.optionSets.currentHpPct.map(o=>o.apDelta).join('・')+'AP'));
  const grant=c.optionSets.statusStacks[0];assert.ok(text.includes(`${grant.value}スタックで追加${grant.apDelta}AP`));
  assert.ok(text.includes('計3回解除し、追加'+c.effects.find(e=>e.id==='remove-random-debuff-self').apDelta+'AP'));
  assert.ok(text.includes(c.optionSets.turnATAmount.map(o=>o.value).join('・')+'で追加'+c.optionSets.turnATAmount.map(o=>o.apDelta).join('・')+'AP'));
});

test("attack, status probabilities, C waiting bonus and turn limit are explicit", () => {
  const attack=compact(section('attack')),status=compact(section('status')),skills=compact(section('skills'));
  assert.ok(attack.includes('出目+max(0,攻撃側AT−防御側DF)'));
  assert.match(attack,/最初の攻撃フェイズ.*×2/);assert.match(attack,/2回目・3回目.*50%/);
  for(const [name,values] of [['荒波','15%・30%・45%'],['逆風','20%・40%・60%'],['湯気','25%・50%・75%'],['追風','30%・60%・90%'],['集中','1.25倍・1.5倍・2倍']]) {
    assert.ok(status.includes(name));assert.ok(status.includes(values),name);
  }
  for(const name of ['亀裂','反撃','清潔'])assert.ok(status.includes(name));
  for(const value of ['6～7ターンなら+1AP','8～9ターンなら+2AP','10ターン以上なら+3AP'])assert.ok(skills.includes(value));
  assert.match(skills,/全効果を終えた後/);assert.match(skills,/必要AP不足を先に補うものでもない/);
  assert.match(compact(section('rule')),/最大50ターン.*50ターン目.*引き分け/);
  const flow=compact(section('flow'));for(const name of ['熱湯風呂','泡風呂','氷風呂','電気風呂'])assert.ok(flow.includes(name));
  assert.match(flow,/20%.*5%.*80%/);
});

test("public page uses the identical common shell, page gate and three accessible panels", async () => {
  const reference = await readFile(new URL("../character-list.html", import.meta.url), "utf8");
  const shell = text => text.match(/<header id="common-menu"[\s\S]*?<\/header>/)[0];
  assert.equal(shell(html), shell(reference));
  for (const path of ["css/common-theme.css", "css/common-menu.css", "css/page-loading.css", "js/pageLoadGate.js", "js/pageEntry.js", "js/commonMenu.js", "js/menuDisplayCache.js"]) assert.ok(html.includes(path));
  assert.match(html, /data-page-src="js\/rulebookPage.js"/);
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 3);
  assert.match(html, /role="tablist"/);
  assert.doesNotMatch(html, /fc2|ローカルストレージ|id="goal"|class="nav"|whiteStripe/);
  assert.match(html, /最終更新：<time datetime="\d{4}-\d{2}-\d{2}">/);
  const entry = gameMenuItems.find(item => item.href === "rulebook.html");
  assert.equal(entry.label, "ルールブック"); assert.equal(entry.login, undefined);
  assert.ok(menuModel({ ready: true, sessionKnown: true, signedIn: false, accounts: [] }).items.includes(entry));
});
test("guide has seven substantive chapters and matching table of contents", () => {
  for (const id of ["start", "characters", "setting", "display", "battle", "profile", "history"]) {
    assert.match(html, new RegExp('<section id="guide-' + id + '">'));
    assert.match(html, new RegExp('href="#guide-' + id + '"'));
    const content=prose(section('guide-'+id));
    assert.ok(content.length>200,id);
    assert.doesNotMatch(content,/今後追加|今後このガイド|準備中|仮文章/);
  }
});

test("guide documents public browsing, account-only controls and actual image limits", () => {
 const display=compact(section('guide-display'));
 for(const {width,height} of Object.values(IMAGE_LIMITS))assert.ok(display.includes(`横${width}×縦${height}px以内`));
 assert.match(display,/画像のURL/);assert.match(display,/キャラ設定/);
 const history=compact(section('guide-history'));assert.match(history,/ログイン.*自分のENo.*未ログイン.*全員/);
 assert.match(history,/星ボタン/);assert.match(history,/ENoを指定.*勝ち・負け・引き分け/);
 assert.match(compact(section('guide-profile')),/本人.*パレットボタン/);
 assert.match(compact(section('guide-profile')),/未ログイン.*表示されません/);
});

test("guidelines link to the implemented board and preserve policies/legal links", () => {
 const guidelines=html.slice(html.indexOf('id="panel-guidelines"'));
 for(const href of ['notice.html?tab=reports','legal.html#terms','legal.html#privacy','legal.html#terms-5','legal.html#terms-6'])
  assert.ok(guidelines.includes('href="'+href+'"'),href);
 assert.doesNotMatch(guidelines,/掲示板は現在準備中/);
 for(const text of ['大量の自動登録は禁止','無断転載や権利侵害は禁止','生成AIで制作した画像や文章も使用できます',
  '明記することを推奨','全年齢向け','嫌がらせ、誹謗中傷、なりすまし'])assert.ok(guidelines.includes(text),text);
 assert.match(guidelines,/最終更新日：<time datetime="\d{4}-\d{2}-\d{2}">/);
});

for (const [panel, anchors] of Object.entries(anchorsByPanel)) {
  for (const id of anchors) test(`section deep link #${id} selects ${panel} and scrolls`, () => {
    const f = fixture('#' + id);
    assert.equal(f.elements.get('panel-' + panel).hidden, false);
    assert.equal(f.elements.get('tab-' + panel).attrs['aria-selected'], 'true');
    assert.equal(f.elements.get(id).scrolled, true);
  });
}
