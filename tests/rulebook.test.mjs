import { createASkillCatalog } from "../js/aSkillCatalog.js";
import { createCSkillCatalog } from "../js/cSkillCatalog.js";
import { createCSkillRules } from "../js/cSkillRules.js";
import { DICE_FRAMES } from "../js/diceFrames.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { IMAGE_LIMITS } from "../js/characterImageValidation.js";
import { mountRulebook } from "../js/rulebookPage.js";
import { gameMenuItems, menuModel } from "../js/commonMenuModel.js";

const html = await readFile(new URL("../rulebook.html", import.meta.url), "utf8");
const ids = ["rule", "goal", "flow", "stats", "dice", "skills", "attack", "status"];
const anchorsByPanel = Object.fromEntries(["guide", "battle", "guidelines"].map(name => {
  const start = html.indexOf('<div id="panel-' + name + '"');
  const next = html.indexOf('<div id="panel-', start + 1);
  const panel = html.slice(start, next < 0 ? html.indexOf('<footer>', start) : next);
  return [name, [...panel.matchAll(/<(?:section|h3)\b[^>]*\bid="([^"]+)"/g)].map(m => m[1])];
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
const compact = value => prose(value).normalize("NFKC").replace(/\s+/g, "");

test("all section IDs are unique and table-of-contents links resolve inside their tab", () => {
  const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(allIds).size, allIds.length);
  for (const name of ["guide", "battle", "guidelines"]) {
    assert.match(html, new RegExp('id="tab-' + name + '"[^>]*aria-controls="panel-' + name + '"'));
    assert.match(html, new RegExp('id="panel-' + name + '"[^>]*aria-labelledby="tab-' + name + '"'));
  }
  for (const [name, sectionIds] of [["guide", ["characters","start","account","setting","mechanics","battle","display","profile","notice"].map(id=>"guide-"+id)], ["battle",ids]]) {
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
  for(const text of ['WoodenRabbitWorks(うでらび)','シマナガサレV3','「アヒル島」','非公式ファンメイド作品',
    '各種画像・UIデザイン・テキスト：なすのすな','プログラム：Codex（OpenAI）を利用して作成'])assert.ok(footer.includes(text),text);
});

test("concise battle sections retain headings, boxes and all dice faces", () => {
  for(const id of ids)assert.match(section(id),/<h2>[^<]+<\/h2>/);
  for(const [id,count] of [['goal',3],['stats',4],['skills',4],['attack',2],['status',8]])
    assert.equal((section(id).match(/class="box"/g)||[]).length,count,id);
  const dice=section('dice').normalize('NFKC');
  for(let face=0;face<=6;face++)assert.match(dice,new RegExp('<li><b>'+face+'</b>'));
  const skills=compact(section('skills')).normalize('NFKC');
  for(const name of ['Aスキル','Cスキル','Bスキル','Dスキル'])assert.ok(skills.includes(name));
});

test("core battle rules reflect current online battles and status changes", () => {
  const text=id=>compact(section(id)).normalize('NFKC');
  assert.match(text('rule'),/相手.*0以下/);assert.match(text('rule'),/両方.*0以下.*引き分け/);
  assert.match(text('rule'),/50ターン.*引き分け/);
  const goal=text('goal');assert.match(goal,/VS/);assert.match(goal,/バトル履歴/);
  assert.match(text('flow'),/通常Cスキル/);assert.match(text('flow'),/特殊Cスキル/);
  assert.match(text('guide-setting'),/特殊発動.*HP.*0以下.*必要AP/);
  const attack=text('attack');assert.match(attack,/最初の攻撃フェイズ.*出目.*×2/);
  assert.match(attack,/AT.*DF/);assert.match(attack,/0未満/);
  const boxes=[...section('status').matchAll(/<div class="boxTitle">([^<]+)<\/div>\s*<p>([\s\S]*?)<\/p>/g)];
  const status=name=>compact(boxes.find(b=>b[1].includes(name))[2]).normalize('NFKC');
  assert.match(status('亀裂'),/1スタック.*2.*固定ダメージ/);
  assert.deepEqual(tableRows('guide-status-chance').find(row=>row[0]==='追風').slice(1,4),['30%','60%','90%']);
  assert.match(status('追風'),/全.*消費/);
  assert.match(status('清潔'),/1スタック.*1回.*最大2スタック/);
  for(const name of ['荒波','逆風','湯気','集中','反撃'])assert.ok(boxes.some(b=>b[1].includes(name)));
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
  assert.doesNotMatch(html, /fc2|ローカルストレージ|class="nav"|whiteStripe/);
  assert.match(html, /最終更新：<time datetime="\d{4}-\d{2}-\d{2}">/);
  const entry = gameMenuItems.find(item => item.href === "rulebook.html");
  assert.equal(entry.label, "ルールブック"); assert.equal(entry.login, undefined);
  assert.ok(menuModel({ ready: true, sessionKnown: true, signedIn: false, accounts: [] }).items.includes(entry));
});
const tableRows = id => {
  const table=html.match(new RegExp('<table id="'+id+'">([\\s\\S]*?)</table>'))?.[1];
  assert.ok(table,id);
  return [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].slice(1).map(row=>
    [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(cell=>prose(cell[1]).normalize("NFKC")));
};
test("guide anchors and semantic reference tables support concise chapters",async()=>{
  for(const id of ['start','characters','account','setting','mechanics','battle','display','profile','notice']) {
    assert.match(section('guide-'+id),/<h2>/);
    assert.ok(html.includes('href="#guide-'+id+'"'));
  }
  // The author can freely edit the world-building prose.
  assert.match(section('guide-characters'),/<p\b[^>]*>\s*\S/);
  for(const [,body] of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)) {
    assert.match(body,/<caption>.+<\/caption>/);assert.match(body,/<thead>/);assert.match(body,/<tbody>/);
    const count=(body.match(/scope="col"/g)||[]).length;assert.ok(count>=2);
    for(const row of body.match(/<tr>[\s\S]*?<\/tr>/g))assert.equal((row.match(/<t[hd]\b/g)||[]).length,count);
    assert.match(body,/scope="row"/);
  }
  const css=await readFile(new URL('../css/rulebook.css',import.meta.url),'utf8');
  assert.match(css,/#panel-guide \.guide-table-wrap[^}]*overflow-x:auto/);
  assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/background:var\(--ui-accent-surface\)/);
  assert.doesNotMatch(html,/ダイスで対戦！アヒルバトラーONLINEONLINE|ダイスで対戦！アヒルバトラー(?!ONLINE)/);
});
test("guide HP, dice and A reference values match production catalogs",()=>{
  const stats=compact(section('guide-setting'));
  assert.match(stats, /MHPはステータスによって自動で決定/);
  assert.match(stats, /AT\+DF\+SPは合計9pt以内/);
  for (const label of ["AT", "DF", "SP"]) assert.ok(tableRows("guide-stats-table").some(row => row[0] === label));
  const dice=tableRows('guide-dice-table');
  for(const frame of Object.values(DICE_FRAMES)) {
    const row=dice.find(r=>r[0]===frame.label);assert.equal(row[1],String(frame.SP));
    if(!frame.editable){assert.equal(row[2],frame.dice.join('・'));assert.ok(row[3].includes(String(frame.dicePoints)));}
    else assert.equal(row[2],`0、${frame.faces[0]}~${frame.faces.at(-1)}`);
  }
  const a=createASkillCatalog(),rows=tableRows('guide-a-effects');
  for(const [id,label] of [['damage-enemy','固定ダメージ'],['heal-self','固定HP回復'],['ap-self-increase','AP操作'],['grant-crack-enemy','強化状態・状態異常の付与'],['remove-random-debuff-self','ランダム状態解除']]){
    const row=rows.find(r=>r[0]===label);for(const option of a.effects.find(e=>e.id===id).amountOptions)
      assert.ok(new RegExp(`${option.value}(?:ダメージ|回復|AP|スタック)?[:：]${option.pointCost}pt`).test(row[1]),id);
  }
  const trigger=tableRows('guide-a-trigger');
  for(let i=1;i<=6;i++)assert.equal(trigger[Math.ceil(i/2)-1][1],a.triggerCosts.byFrequency[i]+'pt');
  assert.ok(stats.includes(`基本${a.basePoints}pt`));assert.ok(stats.includes(`最大${a.maxEffects}枠まで`));
});
test("C tables reflect shared quantity prices, discounts, revival and minimum AP",()=>{
  const c=createCSkillCatalog(),rules=createCSkillRules(),rows=tableRows('guide-c-effects');
  for(const [index,key,percent] of [[0,'damageAmount'],[1,'healAmount'],[2,'currentHpPct',true],[3,'statusMultiplier'],[4,'statusStacks'],[6,'turnATAmount'],[7,'turnCount']]){
    const numbers=text=>(text.match(/\d+(?:\.\d+)?/g)||[]).map(Number);
    assert.deepEqual(numbers(rows[index][1]),c.optionSets[key].map(o=>percent?o.value*100:o.value));
    assert.deepEqual(numbers(rows[index][2]),c.optionSets[key].map(o=>o.apDelta));
  }
  assert.equal(Number(rows[5][2]),c.effects.find(e=>e.id==='remove-random-debuff-self').apDelta);
  assert.deepEqual(tableRows('guide-c-chance'),c.chanceOptions.map(o=>[o.label,String(o.apDiscount)]));
  assert.deepEqual(tableRows('guide-c-revive'),c.optionSets.revivePct.map(o=>[o.value*100+'%',String(o.apDelta)]));
  assert.deepEqual(tableRows('guide-c-repeat').map(r=>r[1]),['100%',...['2','3','default'].map(k=>rules.repeatReviveChance[k]*100+'%')]);
  const text=compact(section('guide-setting'));
  assert.ok(text.includes(`基礎${rules.baseAP}AP`));assert.ok(text.includes(`最終必要APが${rules.minimumAP}APを下回ることはありません`));
  assert.ok(text.includes(`減算はスキル全体で最大${rules.maxDrawbackAP}APまで`));
});
test("guide image limits and public/owner functions remain documented",()=>{
  const display=compact(section('guide-display'));
  for(const {width,height} of [IMAGE_LIMITS.standing, IMAGE_LIMITS.cutin])assert.ok(new RegExp(`横(?:最大)?${width}×縦(?:最大)?${height}px`).test(display));
  assert.ok(display.includes(`アイコンのみ${IMAGE_LIMITS.icon.width}pxまでの画像が設定可能`));
  assert.deepEqual(tableRows("guide-images").slice(1,3).map(row=>row[1]), ["横120×縦120px", "横60×縦60px"]);
  assert.match(display,/画像URL/);
  assert.match(compact(section('guide-profile')),/お気に入り/);
  assert.match(compact(section('guide-profile')),/本人/);
  assert.match(compact(section('guide-profile')),/サイトテーマ/);
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
