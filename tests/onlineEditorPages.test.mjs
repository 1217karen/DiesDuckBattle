import { PROFILE_MESSAGE_MAX, BATTLER_PROFILE_MAX, DUCK_PROFILE_MAX, profileTextError, flavorLabelError, presentationTextIssues } from "../js/profileTextValidation.js";
import { createQuoteEnoLookup } from "../js/quoteEnoLookup.js";
import { presentCSkill } from "../js/cSkillPresentation.js";
import { createQuoteToolbar } from "../js/quoteRichTextToolbar.js";
import { hasName, battlerNameError } from "../js/nameValidation.js";
import { FIXED_IMAGES, setImageFromCandidates } from "../js/fixedImages.js";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createAuthController } from "../js/authController.js";
import { createOnlineEditController } from "../js/onlineEditController.js";
import { createEmptyDuckQuotes, createEmptyDuckPresentation, quoteTimings, createEmptyDuckProfile, createEmptyPlayerPresentation, getQuoteIconUrlCandidates, presentationForPersistence, QUOTE_PATHS, QUOTE_TEXT_MAX, isQuoteEno, createEmptyQuoteLine } from "../js/playerPresentationModel.js";
import { createEmptyPlayerBuild, createEmptyDuck } from "../js/playerBuildModel.js";
import { IMAGE_LIMITS, createImageValidation, imageValidationSummary } from "../js/characterImageValidation.js";
import { encodeOnlinePlayer } from "../js/onlinePlayerDto.js";
const source = async name => (await readFile(new URL(`../js/${name}.js`, import.meta.url), "utf8")).replace(/^import .*;\r?\n/gm, "");

test("authRuntime shares exactly one SDK client/session key across editor and auth initialization", async () => {
  let clients = 0, options, passed;
  const client = {}, controller = { start() {} };
  const context = { supabasePublicConfig: { url: "mock", publishableKey: "public" }, showToast() {},
    sdk: { createClient(_url, _key, opts) { clients++; options = opts; return client; } },
    createAuthService({ client }) { passed = client; }, createAuthController: () => controller };
  const code = (await source("authRuntime")).replaceAll("export function", "function").replace(/await import\("https:[^\"]+"\)/, "sdk");
  const result = await vm.runInNewContext(`(async()=>{${code}\nreturn Promise.all([getSupabaseClient(),getAuthRuntime(),getSupabaseClient()]);})()`, context);
  assert.equal(clients, 1); assert.equal(passed, client); assert.equal(result[0], result[2]); assert.equal(result[1], controller);
  assert.equal(options.auth.storageKey, "diesduck-auth-session");
});
test("common logout respects async editor cancellation and confirmation; unregister restores ordinary logout", async () => {
  let calls = 0, accepted = false;
  const controller = createAuthController({ session: async () => ({ user: { id: "auth" } }), watch: () => () => {},
    accounts: async () => [{ eno: "2", name: "DB名" }], logout: async () => { calls++; } }, () => {});
  await controller.start(); const remove = controller.beforeLogout(async () => accepted);
  await controller.logout(); assert.equal(calls, 0); accepted = true; await controller.logout(); assert.equal(calls, 1);
  remove(); accepted = false; await controller.logout(); assert.equal(calls, 2);
});

async function characterScreen({ siteTheme = null, storageThrows = false } = {}) {
  const elements = new Map(); let hooks, selectedCallback, latest, saved, editCount = 0;
  const themeWrites = [];
  class Element {
    constructor(tag = "div") { this.tagName = tag; this.children = []; this.handlers = {}; this.dataset = {}; this.attributes = {}; this.hidden = false; this.disabled = false; }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    prepend(node) { node.parent = this; this.children.unshift(node); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(event, callback) { this.handlers[event] = callback; }
    focus() {}
    setSelectionRange(start, end) { this.selectionStart=start;this.selectionEnd=end; }
    remove() { this.parent.children = this.parent.children.filter(x => x !== this); }
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return (this.text ?? "") + this.children.map(x => x.textContent).join(""); }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const all = () => { const walk = el => [el, ...el.children.flatMap(walk)]; return [...elements.values()].flatMap(walk); };
  const document = { getElementById: get, querySelector: selector => get(selector.slice(1)),
    querySelectorAll: selector => all().filter(el => `.${el.className}` === selector),
    createElement: tag => new Element(tag), createTextNode: text => { const el = new Element("text"); el.textContent = text; return el; } };
  const data = { build: createEmptyPlayerBuild(), presentation: createEmptyPlayerPresentation(), publicSettings: { schemaVersion: 1, publicDuckId: null }, battlerName: "DB名2" };
  data.build.ducks.push(createEmptyDuck()); data.publicSettings.publicDuckId = data.build.ducks[0].id;
  data.presentation.ducks.orphan = { iconUrl: "https://example.invalid/orphan.png", cutinUrl: "", quotes:createEmptyDuckQuotes(),profile: createEmptyDuckProfile() };
  const controller = { snapshot: () => ({ canSave: true, canEdit: true }),
    edit(patch) { editCount++; latest = { ...latest, ...structuredClone(patch) }; },
    async save() { saved = structuredClone(latest); return { ok: true }; } };
  const context = { PROFILE_MESSAGE_MAX, BATTLER_PROFILE_MAX, DUCK_PROFILE_MAX, profileTextError, flavorLabelError, presentationTextIssues, battlerNameError, presentationForPersistence, QUOTE_PATHS, QUOTE_TEXT_MAX, isQuoteEno, createEmptyQuoteLine, createQuoteEnoLookup, getSupabaseClient: async()=>({}), createOnlineProfileService: ()=>({getProfile:async()=>({ok:false,status:"profile-not-found"})}), finishPageLoad() {}, requireLoginPage: async () => {}, presentCSkill, hasName, FIXED_IMAGES, setImageFromCandidates, getQuoteIconUrlCandidates, createQuoteToolbar, document, structuredClone, createEmptyDuckQuotes, createEmptyDuckPresentation, quoteTimings, createEmptyDuckProfile, createEmptyPlayerPresentation, IMAGE_LIMITS, createImageValidation, imageValidationSummary,
    Option: function (name, value) { const el = new Element("option"); el.textContent = name; el.value = value; return el; },
    createIconPicker: () => ({ open(args) { selectedCallback = args.select; }, close() { selectedCallback = null; } }),
    mountOnlineEditor: async args => { assert.deepEqual(Array.from(args.sections), ["presentation", "battlerName"]); hooks = args; latest = structuredClone(data); args.hydrate(data); args.onState({ canSave: true, canEdit: true }); return controller; } };
  document.documentElement = { dataset: {} };
  context.localStorage = {
    getItem() { if (storageThrows) throw Error("storage blocked"); return siteTheme; },
    setItem(key, value) { if (storageThrows) throw Error("storage blocked"); themeWrites.push([key, value]); siteTheme = value; },
  };
  vm.runInNewContext(await source("siteTheme"), context);
  context.diesDuckSiteTheme.bindAuth({ subscribe(fn) { fn({ sessionKnown: true, signedIn: true }); return () => {}; } });
  await vm.runInNewContext(`(async()=>{${await source("characterPage")}})()`, context);
  return { get, all, data, latest: () => latest, saved: () => saved, hydrate(data) { latest = structuredClone(data); hooks.hydrate(data); hooks.onState({ canSave: true, canEdit: true }); },
    pick(slot) { selectedCallback(slot); }, save: () => get("save").handlers.click(), controller,
    document, themeWrites, editCount: () => editCount };
}
test("actual character handlers preserve full DTO, quotes, ten icon slots, detached Duck URLs and image validation gates", async () => {
  const page = await characterScreen();
  const inputs = () => page.all().filter(el => el.tagName === "input" && el.type === "url");
  assert.equal(inputs().length, 16); // standing/default/10 slots/build Duck/detached Duck
  assert.equal(page.get("save").disabled, true); await page.save(); assert.equal(page.saved(), undefined);
  let image = page.all().find(el => el.tagName === "img" && el.src === "https://example.invalid/orphan.png");
  image.naturalWidth = 251; image.naturalHeight = 1; image.onload(); assert.equal(page.get("save").disabled, true);
  const orphanInput = inputs().find(input => input.value === "https://example.invalid/orphan.png"); orphanInput.value = "https://example.invalid/fixed.png"; orphanInput.handlers.input();
  image = page.all().find(el => el.tagName === "img" && el.src === orphanInput.value);
  image.naturalWidth = 20; image.naturalHeight = 20; image.onload(); assert.equal(page.get("save").disabled, false);
  const slot10 = inputs()[11]; slot10.value = "https://example.invalid/slot10.png"; slot10.handlers.input();
  image = page.all().find(el => el.tagName === "img" && el.src === slot10.value); image.naturalWidth = 250; image.naturalHeight = 250; image.onload();
  const quote = page.all().find(el => el.tagName === "input" && el.type === "text" && el.attributes["aria-label"] !== "プロフィールメッセージ"); quote.value = "オンラインセリフ"; quote.handlers.input();
  page.all().find(el => el.className === "quote-picker").handlers.click(); page.pick(10);
  const beforeRename = structuredClone(page.latest().presentation);
  page.get("battler-name").value = "変更後のバトラー"; page.get("battler-name").handlers.input();
  assert.deepEqual(page.latest().presentation, beforeRename);
  await page.save();
  const saved = page.saved(); assert.deepEqual(saved.build, page.data.build); assert.deepEqual(saved.publicSettings, page.data.publicSettings); assert.equal(saved.battlerName, "変更後のバトラー");
  assert.equal(saved.presentation.battler.iconSlots[9], slot10.value); assert.deepEqual(saved.presentation.battler.quotes.battleStart, { lines:[{ text: quote.value, iconSlot: 10, opponentEno:null }] });
  assert.equal(saved.presentation.ducks.orphan.iconUrl, orphanInput.value);
  page.hydrate(saved); assert.equal(page.get("battler-name").value, "変更後のバトラー"); assert.equal(page.all().find(el => el.tagName === "input" && el.type === "text" && el.attributes["aria-label"] !== "プロフィールメッセージ").value, "オンラインセリフ");
  assert.equal(page.all().find(el => el.className === "quote-picker").title, "追加アイコン 10");
  assert.equal(page.all().find(el => el.className === "quote-picker").children[0].src,slot10.value);
});

test("all quote rows use one-line inputs, six inline controls and live slot/default image previews",async()=>{
  const page=await characterScreen(),data=structuredClone(page.data);
  data.presentation=createEmptyPlayerPresentation();
  data.presentation.battler.defaultIconUrl="default.png";
  data.presentation.battler.iconSlots[2]="third.png";
  data.presentation.battler.quotes.battleStart={ lines: [{text:"  雷アタック  ",iconSlot:null, opponentEno:null}] };
  data.presentation.battler.quotes.skill.B.lines[0].iconSlot=4; // Empty slot retains its ID, shows default.
  page.hydrate(data);
  const rows=page.all().filter(e=>e.className==="quote-row");assert.equal(rows.length,14);
  assert.ok(rows.every(row=>!row.children.some(e=>e.tagName==="textarea")));
  for(const row of rows){
    const [caption,toggle,picker,editor]=row.children;assert.equal(caption.className,"quote-label");assert.equal(picker.textContent,"");
    assert.equal(picker.children[0].tagName,"img");assert.equal(picker.children[0].src,"default.png");
    assert.equal(editor.className,"quote-editor");const input=editor.children[0].children[0],toolbar=editor.children[1].children[0];
    assert.equal(input.tagName,"input");assert.equal(input.type,"text");assert.equal(toolbar.className,"quote-toolbar");
    assert.deepEqual(toolbar.children.map(e=>e.textContent),["B","I","U","rb","小","大"]);
  }
  const [caption,toggle,picker,editor]=rows[0].children,input=editor.children[0].children[0];assert.equal(picker.title,"デフォルトアイコン");
  input.selectionStart=2;input.selectionEnd=3;editor.children[1].children[0].children[3].handlers.click();
  assert.equal(page.latest().presentation.battler.quotes.battleStart.lines[0].text,"  <rb>雷</rb><rt>ルビ</rt>アタック  ");
  assert.equal(input.value.slice(input.selectionStart,input.selectionEnd),"ルビ");
  picker.handlers.click();page.pick(3);assert.equal(picker.title,"追加アイコン 3");assert.equal(picker.children[0].src,"third.png");
  assert.equal(page.latest().presentation.battler.quotes.battleStart.lines[0].iconSlot,3);
  const imageInputs=page.all().filter(e=>e.tagName==="input"&&e.type==="url");
  const third=imageInputs[4];third.value="new-third.png";third.handlers.input();assert.equal(picker.children[0].src,"new-third.png");
  picker.children[0].onerror();assert.equal(picker.children[0].src,"default.png");picker.children[0].onerror();assert.equal(picker.children[0].src,FIXED_IMAGES.battlerIcon);
  third.value="";third.handlers.input();assert.equal(picker.children[0].src,"default.png");assert.equal(page.latest().presentation.battler.quotes.battleStart.lines[0].iconSlot,3);
  imageInputs[1].value="new-default.png";imageInputs[1].handlers.input();assert.equal(picker.children[0].src,"new-default.png");
  picker.handlers.click();page.pick(null);assert.equal(picker.title,"デフォルトアイコン");assert.equal(picker.children[0].src,"new-default.png");
  const quote=page.latest().presentation.battler.quotes.battleStart.lines[0];assert.deepEqual(Object.keys(quote),["text","iconSlot","opponentEno"]);
  assert.equal(quote.iconSlot,null);assert.equal(page.latest().presentation.schemaVersion,6);
});
test("late image callback from prior account cannot block the newly hydrated account", async () => {
  const page = await characterScreen(), old = page.all().find(el => el.tagName === "img" && el.onerror);
  const next = structuredClone(page.data); next.presentation = createEmptyPlayerPresentation(); next.build.ducks = []; next.publicSettings.publicDuckId = null;
  page.hydrate(next); assert.equal(page.get("save").disabled, false);
  old.onerror(); assert.equal(page.get("save").disabled, false); assert.equal(page.get("duck-select").disabled, true);
});
test("shared browser adapter wires unload warning, cancellable discard dialog and immediate session invalidation", async () => {
  const nodes = new Map(), events = new Map(), hydrated = [];
  let watch, guard;
  const document = { visibilityState: "visible", activeElement: null,
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, this.createElement("div")); return nodes.get(id); },
    createElement(tag) { return { tagName: tag, children: [], handlers: {}, isConnected: true,
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
      setAttribute() {}, addEventListener(event, cb) { this.handlers[event] = cb; }, focus() { document.activeElement = this; },
      showModal() { this.open = true; }, close(value = "") { this.open = false; this.returnValue = value; this.handlers.close?.(); }, remove() { this.isConnected = false; },
    }; },
    querySelectorAll() { return this.body.children.filter(node => node.tagName === "dialog" && node.open); },
    addEventListener(event, cb) { events.set(event, cb); }, removeEventListener(event) { events.delete(event); },
  };
  document.body = document.createElement("body");
  const data = { build: createEmptyPlayerBuild(), presentation: createEmptyPlayerPresentation(), publicSettings: { schemaVersion: 1, publicDuckId: null }, battlerName: "DB名2" };
  const result = { ok: true, account: { id: "game-2", eno: "2" }, authUserId: "auth-2", revision: "0", data };
  const context = { document, queueMicrotask, createOnlineEditController, showToast() {},
    window: { addEventListener(event, cb) { events.set(event, cb); }, removeEventListener(event) { events.delete(event); } },
    getSupabaseClient: async () => ({ auth: { onAuthStateChange(cb) { watch = cb; return { data: { subscription: { unsubscribe() {} } } }; } } }),
    getAuthRuntime: async () => ({ beforeLogout(cb) { guard = cb; return () => {}; } }),
    createOnlinePlayerStorage: () => ({ load: async () => structuredClone(result), resolveAccount: async () => structuredClone(result) }),
    hydrate: data => hydrated.push(data),
  };
  const code = (await source("onlineEditor")).replace("export async function", "async function");
  const controller = await vm.runInNewContext(`(async()=>{${code}\nreturn mountOnlineEditor({sections:['build'],hydrate});})()`, context);
  let warned = false; const unload = () => events.get("beforeunload")({ preventDefault() { warned = true; } });
  unload(); assert.equal(warned, false); controller.edit({ build: data.build }); unload(); assert.equal(warned, true);
  const pending = controller.load(), dialog = document.querySelectorAll()[0]; assert.ok(dialog.open);
  assert.equal(document.activeElement.textContent, "キャンセル"); dialog.children.find(child => child.textContent === "キャンセル").handlers.click();
  assert.equal((await pending).status, "cancelled"); assert.equal(controller.snapshot().dirty, true);
  const leaving = guard(), logoutDialog = document.querySelectorAll()[0];
  watch("SIGNED_OUT", null); assert.equal(logoutDialog.open, false); assert.equal(await leaving, false);
  assert.equal(nodes.get("editor").hidden, true); assert.equal(nodes.get("save").disabled, true); assert.equal(hydrated.at(-1), null);
});


test("blank battler names load unchanged but block even a direct save click", async () => {
  for (const value of ["", " ", "　", " \t　\n"]) {
    const page = await characterScreen();
    const data = structuredClone(page.data); data.battlerName = value; data.presentation = createEmptyPlayerPresentation();
    page.hydrate(data);
    assert.equal(page.get("battler-name").value, value);
    assert.equal(page.get("battler-name").attributes["aria-invalid"], "true");
    await page.save(); assert.equal(page.saved(), undefined);
    page.get("battler-name").value = "正常な名前"; page.get("battler-name").handlers.input();
    await page.save(); assert.equal(page.saved().battlerName, "正常な名前");
    assert.deepEqual(page.saved().presentation, data.presentation);
  }
});

test("Duck cut-in editor merges sibling URLs, switches Ducks, and uses common C presentation without repair",async()=>{
  const page=await characterScreen(),data=structuredClone(page.data),first=data.build.ducks[0];
  first.name="一羽目";first.cSelection={mode:"normal",structure:{kind:"flat",effects:[{effectId:"heal-self",options:{amount:"healAmount-30"}}]}};
  const second=createEmptyDuck();second.name="二羽目";data.build.ducks.push(second);
  data.presentation.ducks={ [first.id]:{iconUrl:"first-icon.png",cutinUrl:"first-cutin.png",quotes:createEmptyDuckQuotes(),profile:createEmptyDuckProfile()},[second.id]:{iconUrl:"second-icon.png",cutinUrl:"second-cutin.png",quotes:createEmptyDuckQuotes(),profile:createEmptyDuckProfile()} };
  const before=structuredClone(data.build);page.hydrate(data);assert.deepEqual(page.latest().build,before);
  const editors=page.get("duck-icon-editor").children;assert.equal(editors.length,2);
  assert.equal(editors[0].hidden,false);assert.equal(editors[1].hidden,true);
  const icon=editors[0].children[1],cutin=page.get("duck-quotes-editor").children[0].children[2],description=cutin.children[1],field=cutin.children[2];
  assert.equal(description.textContent,presentCSkill(first.cSelection).text);
  assert.equal(field.className,"image-field cutin-field");assert.equal(field.children[0].className,"image-field-control");
  assert.equal(field.children[1].className,"preview cutin-preview");assert.equal(field.children[1].children.length,1); // no fallback
  const cutinInput=descendants(field).find(e=>e.tagName==="input");
  cutinInput.value="new-cutin.png";cutinInput.handlers.input();
  assert.deepEqual(page.latest().presentation.ducks[first.id],{iconUrl:"first-icon.png",cutinUrl:"new-cutin.png",quotes:createEmptyDuckQuotes(),profile:createEmptyDuckProfile()});
  const iconInput=descendants(icon).find(e=>e.tagName==="input");iconInput.value="new-icon.png";iconInput.handlers.input();
  assert.deepEqual(page.latest().presentation.ducks[first.id],{iconUrl:"new-icon.png",cutinUrl:"new-cutin.png",quotes:createEmptyDuckQuotes(),profile:createEmptyDuckProfile()});
  assert.deepEqual(page.latest().presentation.ducks[second.id],data.presentation.ducks[second.id]);assert.deepEqual(page.latest().build,before);
  page.get("duck-select").value=second.id;page.get("duck-select").onchange();
  assert.equal(editors[0].hidden,true);assert.equal(editors[1].hidden,false);
  assert.equal(page.get("duck-quotes-editor").children[1].children[2].children[1].textContent,"Cスキル未設定");
  data.build.ducks[0].cSelection={mode:"normal",structure:{kind:"flat",effects:[null]}};page.hydrate(data);
  assert.equal(page.get("duck-quotes-editor").children[0].children[2].children[1].textContent,"Cスキル設定未完了");
  assert.deepEqual(page.latest().build,data.build);
});


test("editing a new Duck image creates a complete v2 display and preserves detached profiles",async()=>{
  const page=await characterScreen(),data=structuredClone(page.data),id=data.build.ducks[0].id;
  data.presentation.ducks.orphan.iconUrl='';data.presentation.ducks.orphan.profile.text='保持する本文';
  data.presentation.battler.profile.iconSlots=[1,10];page.hydrate(data);
  const fields=page.all().filter(e=>e.tagName==='input'&&e.type==='url');
  fields[12].value='new.png';fields[12].handlers.input();
  const display=page.latest().presentation.ducks[id];
  assert.deepEqual(display,{iconUrl:'new.png',cutinUrl:'',quotes:createEmptyDuckQuotes(),profile:createEmptyDuckProfile()});
  assert.equal(page.latest().presentation.ducks.orphan.profile.text,'保持する本文');
  assert.doesNotThrow(()=>encodeOnlinePlayer(page.latest()));
});

const descendants = root => [root, ...root.children.flatMap(descendants)];
const aria = (root, label) => descendants(root).find(e => e.attributes['aria-label'] === label);
const inputValue = (input, value, event='input') => { input.value=value; input.handlers[event](); };
async function profileScreen() {
  const page=await characterScreen(),data=structuredClone(page.data);
  data.build.ducks[0].name='一羽目';
  const second=createEmptyDuck();second.name='二羽目';data.build.ducks.push(second);
  data.presentation.ducks.orphan.iconUrl='';data.presentation.ducks.orphan.profile.text='detached';
  data.presentation.battler.profile.theme={background:'#123456',panel:'#234567',text:'#345678',accent:'#456789'};
  data.presentation.battler.profile.featuredBattleId=data.build.ducks[0].id;
  page.hydrate(data);
  return page;
}
const duckRoot = (page,index=0,kind="profile") => page.get(`duck-${kind}-editor`).children[index];
const battlerText = page => aria(page.get('battler-profile'),'バトラープロフィール');
test('name and profile limits retain input, count emoji, and validate toolbar insertion',async()=>{
 const page=await profileScreen(),name=page.get('battler-name');
 inputValue(name,'😀'.repeat(15));assert.equal(page.get('save').disabled,false);
 inputValue(name,'😀'.repeat(16));assert.equal(name.attributes['aria-invalid'],'true');
 await page.save();assert.equal(page.saved(),undefined);assert.equal(name.value,'😀'.repeat(16));
 inputValue(name,'バトラー');const field=battlerText(page);
 inputValue(field,'😀'.repeat(2000));assert.equal(field.attributes['aria-invalid'],'false');
 field.selectionStart=0;field.selectionEnd=2;
 aria(page.get('battler-profile'),'プロフィールの文字装飾').children[0].handlers.click();
 assert.equal(field.attributes['aria-invalid'],'true');assert.equal(page.get('save').disabled,true);
 assert.match(field.value,/<b>😀<\/b>/);await page.save();assert.equal(page.saved(),undefined);
 inputValue(field,'修正済み');await page.save();assert.equal(page.saved().presentation.battler.profile.text,'修正済み');
});
test('loaded overlong detached profiles and hidden flavor labels block saving without losing values',async()=>{
 const page=await profileScreen(),data=structuredClone(page.latest());
 data.presentation.ducks.orphan.profile=createEmptyDuckProfile();
 data.presentation.ducks.orphan.profile.text='😀'.repeat(301);page.hydrate(data);
 assert.equal(page.get('save').disabled,true);await page.save();assert.equal(page.saved(),undefined);
 const detached=aria(duckRoot(page,2),'アヒルプロフィール');
 assert.equal(detached.value,'😀'.repeat(301));assert.equal(detached.attributes['aria-invalid'],'true');
 inputValue(detached,'😀'.repeat(300));assert.equal(page.get('save').disabled,false);
 descendants(duckRoot(page)).find(e=>e.tagName==='button'&&e.textContent==='＋ フレーバーステータス').handlers.click();
 const label=aria(duckRoot(page),'フレーバーステータス1の名前');inputValue(label,'あいうえおか');
 page.get('duck-select').value='orphan';page.get('duck-select').onchange();
 assert.equal(page.get('save').disabled,true);assert.match(page.get('profile-validation-message').textContent,/一羽目/);
 await page.save();assert.equal(page.saved(),undefined);assert.equal(label.attributes['aria-invalid'],'true');
 inputValue(label,'abcあいう');await page.save();assert.ok(page.saved());
});
const checkboxes = page => page.all().filter(e=>e.type==='checkbox'&&e.parent.className==='profile-icon-choice');

test('Battler multiline profile and shared toolbar save/rehydrate without touching existing data',async()=>{
  const page=await profileScreen(),before=structuredClone(page.latest());
  const text='  本文\n 次の行  \n';inputValue(battlerText(page),text);
  const toolbar=aria(page.get('battler-profile'),'プロフィールの文字装飾');
  assert.deepEqual(toolbar.children.map(b=>b.title),['太字','斜体','下線','ルビ','小さい文字','大きい文字']);
  battlerText(page).selectionStart=2;battlerText(page).selectionEnd=4;toolbar.children[0].handlers.click();
  const expected='  <b>本文</b>\n 次の行  \n';
  await page.save();assert.equal(page.saved().presentation.battler.profile.text,expected);
  const wanted=structuredClone(before);wanted.presentation.battler.profile.text=expected;
  assert.deepEqual(page.saved(),wanted);assert.doesNotThrow(()=>encodeOnlinePlayer(page.saved()));
  page.hydrate(page.saved());assert.equal(battlerText(page).value,expected);
  assert.equal(battlerText(page).maxLength,undefined);
  assert.ok(page.all().some(e=>e.attributes['aria-label']==='セリフの文字装飾'));
});

test('ten independent profile checkboxes enforce max four, ascending unique slots and retain empty URLs',async()=>{
  const page=await profileScreen(),boxes=checkboxes(page);assert.equal(boxes.length,10);
  const toggle=(slot,checked)=>{boxes[slot-1].checked=checked;boxes[slot-1].handlers.change();};
  for(const slot of [10,3,7,1])toggle(slot,true);
  assert.deepEqual(page.latest().presentation.battler.profile.iconSlots,[1,3,7,10]);
  assert.equal(boxes.filter(b=>b.disabled).length,6);assert.ok(boxes.filter(b=>b.checked).every(b=>!b.disabled));
  toggle(3,true);assert.deepEqual(page.latest().presentation.battler.profile.iconSlots,[1,3,7,10]);
  toggle(2,true);assert.equal(boxes[1].checked,false); // direct invocation cannot exceed four
  toggle(7,false);assert.ok(boxes.every(b=>!b.disabled));toggle(2,true);
  assert.deepEqual(page.latest().presentation.battler.profile.iconSlots,[1,2,3,10]);
  assert.deepEqual(page.latest().presentation.battler.iconSlots,Array(10).fill(''));
  await page.save();assert.doesNotThrow(()=>encodeOnlinePlayer(page.saved()));page.hydrate(page.saved());
  assert.deepEqual(checkboxes(page).map((b,i)=>b.checked?i+1:null).filter(Boolean),[1,2,3,10]);
});

test('Duck profiles are independent including detached Duck; text, types and label presets roundtrip',async()=>{
  const page=await profileScreen(),before=structuredClone(page.latest()),ids=before.build.ducks.map(d=>d.id);
  const select=page.get('duck-select');assert.match(select.children.at(-1).textContent,/戦闘設定なし/);
  for(const [index,text]of [[0,'  一\n羽  '],[1,' 二羽\n'],[2,' detached編集 ']]) {
    select.value=index===2?'orphan':ids[index];select.onchange();
    assert.equal(duckRoot(page,index).hidden,false);
    const input=aria(duckRoot(page,index),'アヒルプロフィール');inputValue(input,text);
    input.selectionStart=0;input.selectionEnd=0;aria(duckRoot(page,index),'プロフィールの文字装飾').children[4].handlers.click();
  }
  const own=aria(duckRoot(page),'タイプ');
  assert.deepEqual(own.children.map(e=>e.value),['','attack','defense','speed','heal','technical','normal']);
  for(const type of ['', 'attack','defense','speed','heal','technical','normal']) {
    inputValue(own,type,'change');await page.save();assert.equal(page.saved().presentation.ducks[ids[0]].profile.type,type||null);
    assert.doesNotThrow(()=>encodeOnlinePlayer(page.saved()));
  }
  for(const preset of ['default','kanji','english','hiragana']) {
    inputValue(aria(duckRoot(page),'ステータス表記'),preset,'change');await page.save();page.hydrate(page.saved());
    assert.equal(aria(duckRoot(page),'ステータス表記').value,preset);
  }
  for(const [index,text]of [[0,'  一\n羽  '],[1,' 二羽\n'],[2,' detached編集 ']])
    assert.equal(aria(duckRoot(page,index),'アヒルプロフィール').value,'<small></small>'+text);
  assert.deepEqual(page.latest().build,before.build);assert.deepEqual(page.latest().publicSettings,before.publicSettings);
  assert.deepEqual(page.latest().presentation.battler,before.presentation.battler);
  assert.equal(page.latest().presentation.ducks.orphan.cutinUrl,'');
});

test('attributes count code points, block direct save while invalid even on hidden Duck, and recover',async()=>{
  const page=await profileScreen(),id=page.latest().build.ducks[0].id;
  const fields=[1,2,3].map(i=>aria(duckRoot(page),`属性${i}`));assert.ok(fields.every(Boolean));
  for(const value of ['','A','あ','炎','😀']) {
    inputValue(fields[0],value);assert.equal(fields[0].attributes['aria-invalid'],'false');
    assert.equal(page.get('save').disabled,false);assert.doesNotThrow(()=>encodeOnlinePlayer(page.latest()));
  }
  for(const value of ['炎闇','😀😀','e\u0301']){
    inputValue(fields[1],value);assert.equal(fields[1].value,value);assert.equal(fields[1].attributes['aria-invalid'],'true');
    assert.equal(page.latest().presentation.ducks[id].profile.attributes[1],value);
    assert.equal(page.get('save').disabled,true);assert.match(page.get('profile-validation-message').textContent,/一羽目.*属性2/);
    page.get('duck-select').value='orphan';page.get('duck-select').onchange();
    await page.save();assert.equal(page.saved(),undefined);
    inputValue(fields[1],'闇');assert.equal(page.get('save').disabled,false);
  }
  await page.save();assert.deepEqual(page.saved().presentation.ducks[id].profile.attributes,['😀','闇','']);
  assert.doesNotThrow(()=>encodeOnlinePlayer(page.saved()));page.hydrate(page.saved());
  assert.equal(aria(duckRoot(page),'属性1').value,'😀');
  inputValue(aria(duckRoot(page),'属性1'),'ab');page.hydrate(page.saved());assert.equal(page.get('save').disabled,false);
  page.get('battler-name').value=' ';page.get('battler-name').handlers.input();assert.equal(page.get('save').disabled,true);
});

test('flavor stats add up to two, preserve empty/width-limited labels and values 0..6, delete without reordering',async()=>{
  const page=await profileScreen(),id=page.latest().build.ducks[0].id;
  const add=()=>descendants(duckRoot(page)).find(e=>e.tagName==='button'&&e.textContent==='＋ フレーバーステータス');
  const rows=()=>descendants(duckRoot(page)).filter(e=>e.className==='flavor-row');
  assert.equal(rows().length,0);add().handlers.click();assert.equal(rows().length,1);
  assert.deepEqual(page.latest().presentation.ducks[id].profile.flavorStats,[{label:'',value:0}]);
  add().handlers.click();assert.equal(rows().length,2);assert.equal(add().disabled,true);
  add().handlers.click();assert.equal(rows().length,2);
  inputValue(aria(duckRoot(page),'フレーバーステータス1の名前'),'  食欲  ');
  inputValue(aria(duckRoot(page),'フレーバーステータス2の名前'),'二行目');
  for(let value=0;value<=6;value++){
    inputValue(aria(duckRoot(page),'フレーバーステータス2の値'),String(value),'change');await page.save();
    assert.equal(page.saved().presentation.ducks[id].profile.flavorStats[1].value,value);assert.doesNotThrow(()=>encodeOnlinePlayer(page.saved()));
  }
  aria(duckRoot(page),'フレーバーステータス1を削除').handlers.click();assert.equal(add().disabled,false);
  assert.deepEqual(page.latest().presentation.ducks[id].profile.flavorStats,[{label:'二行目',value:6}]);
  await page.save();page.hydrate(page.saved());assert.equal(aria(duckRoot(page),'フレーバーステータス1の値').value,'6');
  aria(duckRoot(page),'フレーバーステータス1を削除').handlers.click();await page.save();
  assert.deepEqual(page.saved().presentation.ducks[id].profile.flavorStats,[]);assert.equal(add().disabled,false);
});

test('profile edits preserve all images, quotes, theme, featured battle and other Duck data',async()=>{
 const page=await profileScreen(),data=structuredClone(page.latest()),id=data.build.ducks[0].id;
 data.presentation.battler.standingImageUrl='standing.png';data.presentation.battler.defaultIconUrl='default.png';data.presentation.battler.iconSlots[3]='slot.png';
 data.presentation.battler.quotes.battleStart.lines[0].text=' quote ';
 data.presentation.ducks[id]={iconUrl:'duck.png',cutinUrl:'cutin.png',quotes:createEmptyDuckQuotes(),profile:createEmptyDuckProfile()};
 page.hydrate(data);
 for(const image of page.all().filter(e=>e.tagName==='img'&&e.onload)){image.naturalWidth=20;image.naturalHeight=20;image.onload();}
 inputValue(battlerText(page),'Battler');inputValue(aria(duckRoot(page),'アヒルプロフィール'),'Duck');
 await page.save();const expected=structuredClone(data);expected.presentation.battler.profile.text='Battler';expected.presentation.ducks[id].profile.text='Duck';
 assert.deepEqual(page.saved(),expected);assert.doesNotThrow(()=>encodeOnlinePlayer(page.saved()));
 const url=page.all().find(e=>e.type==='url'&&e.value==='duck.png');inputValue(url,'bad.png');
 const bad=page.all().find(e=>e.tagName==='img'&&e.src==='bad.png');bad.naturalWidth=999;bad.naturalHeight=999;bad.onload();
 assert.equal(page.get('save').disabled,true);inputValue(aria(duckRoot(page),'属性1'),'a');assert.equal(page.get('save').disabled,true);
});

const walkQuote = el => [el,...el.children.flatMap(walkQuote)];
const quoteParts = row => ({ action:row.children[1],picker:row.children[2],input:row.children[3].children[0].children[0],
  remove:row.children[3].children[0].children[1],controls:row.children[3].children[1],
  eno:walkQuote(row).find(e=>e.className==='quote-eno')?.children[1] });
test('v3 timing UI starts closed, opens once, preserves drafts, inserts after row, deletes and prunes only exact empty text',async()=>{
 const page=await characterScreen(),data=structuredClone(page.data);data.presentation=createEmptyPlayerPresentation();page.hydrate(data);
 const block=page.all().find(e=>e.className==='quote-timing-block'),primary=quoteParts(block.children[0]),extras=block.children[1];
 assert.equal(primary.remove,undefined);assert.equal(primary.eno,undefined);assert.equal(primary.controls.children[0].children.length,6);
 assert.equal(extras.hidden,true);assert.equal(primary.action.textContent,'▶');assert.equal(primary.action.className,'quote-toggle');
 primary.action.handlers.click();assert.equal(extras.hidden,false);assert.equal(extras.children.length,1);assert.match(block.className,/is-open/);
 let second=quoteParts(extras.children[0]);assert.equal(second.controls.children[0].children.length,6);assert.ok(second.eno);
 second.input.value='second';second.input.handlers.input();second.eno.value='15';second.eno.handlers.input();second.picker.handlers.click();page.pick(7);
 primary.action.handlers.click();assert.equal(extras.hidden,true);assert.equal(second.input.value,'second');assert.equal(second.eno.value,'15');
 assert.match(primary.action.className,/has-extras/);primary.action.handlers.click();assert.equal(extras.children.length,1);assert.equal(second.picker.title,'追加アイコン 7');
 second.action.handlers.click();let third=quoteParts(extras.children[1]);third.input.value='third';third.input.handlers.input();
 second=quoteParts(extras.children[0]);second.action.handlers.click();assert.equal(extras.children.length,3);
 assert.deepEqual(extras.children.map(r=>quoteParts(r).input.value),['second','','third']);
 assert.equal(page.latest().presentation.battler.quotes.battleStart.lines.length,3);
 let middle=quoteParts(extras.children[1]);middle.input.value=' ';middle.input.handlers.input();assert.equal(page.latest().presentation.battler.quotes.battleStart.lines.length,4);
 middle.input.value='';middle.input.handlers.input();assert.equal(page.latest().presentation.battler.quotes.battleStart.lines.length,3);
 middle.remove.handlers.click();assert.deepEqual(extras.children.map(r=>quoteParts(r).input.value),['second','third']);
 assert.deepEqual(page.latest().presentation.battler.quotes.battleStart.lines[1],{text:'second',iconSlot:7,opponentEno:'15'});
 primary.action.handlers.click();primary.action.handlers.click();assert.equal(extras.children.length,2);
 const saved=structuredClone(page.latest());page.hydrate(saved);
 const loaded=page.all().find(e=>e.className==='quote-timing-block'),toggle=quoteParts(loaded.children[0]).action;
 assert.equal(loaded.children[1].hidden,true);assert.equal(toggle.textContent,'▶');assert.match(toggle.className,/has-extras/);
 toggle.handlers.click();assert.equal(loaded.children[1].children.length,2);
});
test('v3 UI blocks invalid text and ENo, counts code points and tags, retains empty UI rows on close',async()=>{
 const page=await characterScreen(),data=structuredClone(page.data);data.presentation=createEmptyPlayerPresentation();page.hydrate(data);
 const block=page.all().find(e=>e.className==='quote-timing-block'),primary=quoteParts(block.children[0]),extras=block.children[1];
 primary.input.value='😀'.repeat(200);primary.input.handlers.input();assert.equal(primary.input.attributes['aria-invalid'],'false');assert.equal(page.get('save').disabled,false);
 primary.input.value='<b>'+'a'.repeat(194)+'</b>';primary.input.handlers.input();assert.equal(primary.input.attributes['aria-invalid'],'true');assert.equal(page.get('save').disabled,true);
 await page.save();assert.equal(page.saved(),undefined);assert.match(page.get('profile-validation-message').textContent,/200/);
 primary.input.value='';primary.input.handlers.input();primary.action.handlers.click();const second=quoteParts(extras.children[0]);
 second.eno.value='01';second.eno.handlers.input();assert.equal(second.eno.attributes['aria-invalid'],'true');assert.equal(page.get('save').disabled,true);
 second.eno.value='9223372036854775807';second.eno.handlers.input();assert.equal(second.eno.attributes['aria-invalid'],'false');assert.equal(page.get('save').disabled,false);
 primary.action.handlers.click();primary.action.handlers.click();assert.equal(extras.children.length,1);assert.equal(second.eno.value,'9223372036854775807');
 await page.save();assert.equal(page.saved().presentation.battler.quotes.battleStart.lines.length,1);
 page.hydrate(page.saved());const reloaded=page.all().find(e=>e.className==='quote-timing-block');assert.equal(quoteParts(reloaded.children[0]).action.className,'quote-toggle');
});

test('best streak checkbox changes only its profile field and survives save/rehydrate',async()=>{
 const page=await profileScreen(),before=structuredClone(page.latest());
 const root=page.get('battler-profile');
 assert.equal(root.children[0].tagName,'h3');assert.equal(root.children[0].textContent,'プロフィール');
 assert.deepEqual(root.children.slice(1).map(e=>e.className),['profile-text-editor','profile-message-tail','profile-text-editor','profile-streak-visibility','site-theme-setting']);
 assert.ok(descendants(root.children[3]).includes(aria(root,'プロフィールの文字装飾')));
 const find=()=>aria(page.get('battler-profile'),'キャラリストに最大連勝数を表示する');
 assert.equal(find().checked,true);find().checked=false;find().handlers.change();await page.save();
 const expected=structuredClone(before);expected.presentation.battler.profile.showBestStreak=false;
 assert.deepEqual(page.saved(),expected);page.hydrate(page.saved());assert.equal(find().checked,false);
 find().checked=true;find().handlers.change();await page.save();assert.deepEqual(page.saved(),before);
});

for (const theme of ['light','dark']) test('site theme radio starts at saved '+theme+' and never edits online presentation',async()=>{
 const page=await characterScreen({siteTheme:theme}),before=structuredClone(page.latest()),edits=page.editCount();
 const radios=()=>page.all().filter(e=>e.tagName==='input'&&e.type==='radio'&&e.name==='site-theme');
 assert.equal(radios().length,2);assert.equal(radios().find(e=>e.value===theme).checked,true);
 const root=page.get('battler-profile');assert.equal(root.children[5].className,'site-theme-setting');
 const next=theme==='light'?'dark':'light',radio=radios().find(e=>e.value===next);
 radio.checked=true;radio.handlers.change();
 assert.equal(page.document.documentElement.dataset.theme,next);
 assert.deepEqual(page.themeWrites,[['diesduck-site-theme',next]]);
 assert.equal(page.editCount(),edits);assert.deepEqual(page.latest(),before);
 assert.deepEqual(page.latest().presentation.battler.profile.theme,before.presentation.battler.profile.theme);
 assert.equal(page.saved(),undefined);
 page.hydrate(before);assert.equal(radios().find(e=>e.value===next).checked,true);
});
test('site theme radios still work when localStorage throws',async()=>{
 const page=await characterScreen({storageThrows:true}),before=structuredClone(page.latest()),edits=page.editCount();
 const radio=page.all().find(e=>e.type==='radio'&&e.name==='site-theme'&&e.value==='dark');
 radio.checked=true;assert.doesNotThrow(()=>radio.handlers.change());
 assert.equal(page.document.documentElement.dataset.theme,'dark');
 assert.deepEqual(page.latest(),before);assert.equal(page.editCount(),edits);
});

test('message input and tail use dirty/save validation and preserve sibling data on rehydrate',async()=>{
 const page=await profileScreen(),before=structuredClone(page.latest()),edits=page.editCount();
 const input=aria(page.get('battler-profile'),'プロフィールメッセージ');
 const tail=aria(page.get('battler-profile'),'吹き出しとして表示する');
 assert.equal(input.tagName,'input');assert.equal(input.type,'text');assert.equal(input.value,'');assert.equal(tail.checked,false);
 assert.equal(descendants(page.get('battler-profile').children[1]).some(e=>e.attributes['aria-label']==='プロフィールの文字装飾'),false);
 input.value='😀'.repeat(101);input.handlers.input();assert.equal(page.get('save').disabled,true);
 assert.equal(input.attributes['aria-invalid'],'true');assert.match(page.get('battler-profile').children[1].textContent,/100文字/);
 await page.save();assert.equal(page.saved(),undefined);
 input.value='<b>hello</b>';input.handlers.input();tail.checked=true;tail.handlers.change();
 assert.ok(page.editCount()>edits);assert.equal(page.get('save').disabled,false);await page.save();
 const expected=structuredClone(before);expected.presentation.battler.profile.message=input.value;expected.presentation.battler.profile.messageTail=true;
 assert.deepEqual(page.saved(),expected);page.hydrate(page.saved());
 assert.equal(aria(page.get('battler-profile'),'プロフィールメッセージ').value,input.value);
 const loaded=aria(page.get('battler-profile'),'吹き出しとして表示する');assert.equal(loaded.checked,true);
 loaded.checked=false;loaded.handlers.change();await page.save();assert.equal(page.saved().presentation.battler.profile.messageTail,false);
});

test('Duck A/C order, switching, extra ENo/icon controls, validation and rehydration',async()=>{
 const page=await profileScreen(),before=structuredClone(page.latest()),ids=before.build.ducks.map(d=>d.id);
 const root=duckRoot(page,0,"quotes"),a=aria(root,'Aスキルセリフ Aのセリフ'),c=aria(root,'Cスキルセリフ Cのセリフ');
 assert.equal(duckRoot(page,0,'icon').children[1].className,'image-field');assert.equal(duckRoot(page).className,'duck-profile');
 assert.ok(descendants(root.children[0]).includes(a));assert.ok(descendants(root.children[1]).includes(c));assert.equal(root.children[2].className,'duck-cutin');
 assert.equal(aria(page.get('quotes'),'スキル発動 Aのセリフ'),undefined);assert.equal(aria(page.get('quotes'),'スキル発動 Cのセリフ'),undefined);
 inputValue(a,'first A');inputValue(c,'first C');
 const toggle=aria(root,'Aスキルセリフ Aの追加セリフ');toggle.handlers.click();
 const texts=descendants(root).filter(e=>e.attributes['aria-label']==='Aスキルセリフ Aのセリフ');inputValue(texts[1],'<b>extra</b>');
 const eno=aria(root,'Aスキルセリフ Aの対象ENo');inputValue(eno,'01');assert.equal(page.get('save').disabled,true);inputValue(eno,'15');
 const pickers=descendants(root.children[0]).filter(e=>e.className==='quote-picker');pickers[1].handlers.click();page.pick(10);
 assert.equal(page.latest().presentation.ducks[ids[0]].quotes.skill.A.lines[1].iconSlot,10);
 page.get('duck-select').value=ids[1];page.get('duck-select').onchange();assert.equal(root.hidden,true);assert.equal(duckRoot(page,1,'quotes').hidden,false);
 inputValue(aria(duckRoot(page,1,'quotes'),'Aスキルセリフ Aのセリフ'),'second A');
 inputValue(c,'😀'.repeat(201));assert.equal(page.get('save').disabled,true);await page.save();assert.equal(page.saved(),undefined);
 inputValue(c,'first C');await page.save();assert.deepEqual(page.saved().presentation.battler,before.presentation.battler);
 page.hydrate(page.saved());assert.equal(aria(duckRoot(page,0,'quotes'),'Aスキルセリフ Aのセリフ').value,'first A');assert.equal(aria(duckRoot(page,1,'quotes'),'Aスキルセリフ Aのセリフ').value,'second A');
 const first=page.saved().presentation.ducks[ids[0]].quotes;assert.deepEqual(first.skill.A.lines[1],{text:'<b>extra</b>',iconSlot:10,opponentEno:'15'});
 assert.equal(page.saved().presentation.ducks.orphan.profile.text,'detached');
});

test('Duck cards group their controls and switch icon, profile and quotes together, including detached Ducks',async()=>{
 const html=await readFile(new URL('../character.html',import.meta.url),'utf8');
 const section=html.split('<section aria-labelledby="duck-heading">')[1].split('</section>')[0];
 assert.equal((section.match(/class="card /g)||[]).length,3);
 assert.match(section,/<div class="card duck-card">\s*<label>対象アヒル<select id="duck-select">[\s\S]*id="duck-icon-editor"/);
 assert.match(section,/<div class="card duck-profile-card">\s*<h3>プロフィール<\/h3>\s*<div id="duck-profile-editor"/);
 assert.match(section,/<div class="card duck-quotes-card">\s*<h3>セリフ・カットイン<\/h3>\s*<div id="duck-quotes-editor"/);
 const page=await profileScreen(),before=structuredClone(page.latest()),ids=[...before.build.ducks.map(d=>d.id),'orphan'];
 for(const [index,id] of ids.entries()){
  page.get('duck-select').value=id;page.get('duck-select').onchange();
  for(const kind of ['icon','profile','quotes']){
   const roots=page.get(`duck-${kind}-editor`).children;
   assert.equal(roots.length,3);assert.deepEqual(roots.map(root=>root.hidden),ids.map((_,i)=>i!==index));
  }
  assert.equal(duckRoot(page,index,'icon').children[1].className,'image-field');
  const profile=duckRoot(page,index),quotes=duckRoot(page,index,'quotes');
  const labels=descendants(profile).filter(e=>e.tagName==='input'||e.tagName==='select'||e.tagName==='textarea').map(e=>e.attributes['aria-label']);
  assert.deepEqual(labels,['タイプ','属性1','属性2','属性3','ステータス表記','アヒルプロフィール']);
  assert.ok(aria(quotes.children[0],'Aスキルセリフ Aのセリフ'));
  assert.ok(aria(quotes.children[1],'Cスキルセリフ Cのセリフ'));
  assert.equal(quotes.children[2].className,'duck-cutin');
  assert.equal(quotes.children[0].children[0].className,'quote-group');
 }
 assert.deepEqual(page.latest(),before); // Merely switching never allocates or edits presentation data.
 page.hydrate(null);
 for(const kind of ['icon','profile','quotes'])assert.equal(page.get(`duck-${kind}-editor`).children.length,0);
});

test('character subheadings retain label association and Battler titles while Duck A/C titles are omitted',async()=>{
 const html=await readFile(new URL('../character.html',import.meta.url),'utf8');
 const css=await readFile(new URL('../css/character.css',import.meta.url),'utf8');
 assert.match(html,/<h3><label for="battler-name">バトラー名<\/label><\/h3><input id="battler-name"/);
 assert.doesNotMatch(html,/<h3>対象アヒル・アイコン<\/h3>/);
 assert.match(css,/#editor h3\s*\{ color:var\(--accent\); \}/);
 const page=await profileScreen();
 assert.deepEqual(page.get('quotes').children.map(card=>card.children[0].textContent),['戦闘開始','ターン開始','フェイズ開始','スキル発動','戦闘終了']);
 for(const root of page.get('duck-quotes-editor').children){
  assert.equal(descendants(root.children[0]).some(e=>e.tagName==='h3'),false);
  assert.equal(descendants(root.children[1]).some(e=>e.tagName==='h3'),false);
  assert.ok(aria(root.children[0],'Aスキルセリフ Aのセリフ'));
  assert.ok(aria(root.children[1],'Cスキルセリフ Cのセリフ'));
  assert.equal(root.children[2].children[0].tagName,'h3');
 }
});
