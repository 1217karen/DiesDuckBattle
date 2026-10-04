import { presentCSkill } from "../js/cSkillPresentation.js";
import { createQuoteToolbar } from "../js/quoteRichTextToolbar.js";
import { hasName } from "../js/nameValidation.js";
import { FIXED_IMAGES, setImageFromCandidates } from "../js/fixedImages.js";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createAuthController } from "../js/authController.js";
import { createOnlineEditController } from "../js/onlineEditController.js";
import { createEmptyPlayerPresentation, getQuoteIconUrlCandidates } from "../js/playerPresentationModel.js";
import { createEmptyPlayerBuild, createEmptyDuck } from "../js/playerBuildModel.js";
import { IMAGE_LIMITS, createImageValidation, imageValidationSummary } from "../js/characterImageValidation.js";
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

async function characterScreen() {
  const elements = new Map(); let hooks, selectedCallback, latest, saved;
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
  data.presentation.ducks.orphan = { iconUrl: "https://example.invalid/orphan.png" };
  const controller = { snapshot: () => ({ canSave: true, canEdit: true }),
    edit(patch) { latest = { ...latest, ...structuredClone(patch) }; },
    async save() { saved = structuredClone(latest); return { ok: true }; } };
  const context = { requireLoginPage: async () => {}, presentCSkill, hasName, FIXED_IMAGES, setImageFromCandidates, getQuoteIconUrlCandidates, createQuoteToolbar, document, structuredClone, createEmptyPlayerPresentation, IMAGE_LIMITS, createImageValidation, imageValidationSummary,
    Option: function (name, value) { const el = new Element("option"); el.textContent = name; el.value = value; return el; },
    createIconPicker: () => ({ open(args) { selectedCallback = args.select; }, close() { selectedCallback = null; } }),
    mountOnlineEditor: async args => { assert.deepEqual(Array.from(args.sections), ["presentation", "battlerName"]); hooks = args; latest = structuredClone(data); args.hydrate(data); args.onState({ canSave: true, canEdit: true }); return controller; } };
  await vm.runInNewContext(`(async()=>{${await source("characterPage")}})()`, context);
  return { get, all, data, latest: () => latest, saved: () => saved, hydrate(data) { latest = structuredClone(data); hooks.hydrate(data); hooks.onState({ canSave: true, canEdit: true }); },
    pick(slot) { selectedCallback(slot); }, save: () => get("save").handlers.click(), controller };
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
  const quote = page.all().find(el => el.tagName === "input" && el.type === "text"); quote.value = "オンラインセリフ"; quote.handlers.input();
  page.all().find(el => el.className === "quote-picker").handlers.click(); page.pick(10);
  const beforeRename = structuredClone(page.latest().presentation);
  page.get("battler-name").value = "変更後のバトラー"; page.get("battler-name").handlers.input();
  assert.deepEqual(page.latest().presentation, beforeRename);
  await page.save();
  const saved = page.saved(); assert.deepEqual(saved.build, page.data.build); assert.deepEqual(saved.publicSettings, page.data.publicSettings); assert.equal(saved.battlerName, "変更後のバトラー");
  assert.equal(saved.presentation.battler.iconSlots[9], slot10.value); assert.deepEqual(saved.presentation.battler.quotes.battleStart, { text: quote.value, iconSlot: 10 });
  assert.equal(saved.presentation.ducks.orphan.iconUrl, orphanInput.value);
  page.hydrate(saved); assert.equal(page.get("battler-name").value, "変更後のバトラー"); assert.equal(page.all().find(el => el.tagName === "input" && el.type === "text").value, "オンラインセリフ");
  assert.equal(page.all().find(el => el.className === "quote-picker").title, "追加アイコン 10");
  assert.equal(page.all().find(el => el.className === "quote-picker").children[0].src,slot10.value);
});

test("all quote rows use one-line inputs, six inline controls and live slot/default image previews",async()=>{
  const page=await characterScreen(),data=structuredClone(page.data);
  data.presentation=createEmptyPlayerPresentation();
  data.presentation.battler.defaultIconUrl="default.png";
  data.presentation.battler.iconSlots[2]="third.png";
  data.presentation.battler.quotes.battleStart={text:"  雷アタック  ",iconSlot:null};
  data.presentation.battler.quotes.skill.A.iconSlot=4; // Empty slot retains its ID, shows default.
  page.hydrate(data);
  const rows=page.all().filter(e=>e.className==="quote-row");assert.equal(rows.length,14);
  assert.equal(page.all().filter(e=>e.tagName==="textarea").length,0);
  for(const row of rows){
    const [caption,picker,editor]=row.children;assert.equal(caption.className,"quote-label");assert.equal(picker.textContent,"");
    assert.equal(picker.children[0].tagName,"img");assert.equal(picker.children[0].src,"default.png");
    assert.equal(editor.className,"quote-editor");const [input,toolbar]=editor.children;
    assert.equal(input.tagName,"input");assert.equal(input.type,"text");assert.equal(toolbar.className,"quote-toolbar");
    assert.deepEqual(toolbar.children.map(e=>e.textContent),["B","I","U","rb","小","大"]);
  }
  const [caption,picker,editor]=rows[0].children,input=editor.children[0];assert.equal(picker.title,"デフォルトアイコン");
  input.selectionStart=2;input.selectionEnd=3;editor.children[1].children[3].handlers.click();
  assert.equal(page.latest().presentation.battler.quotes.battleStart.text,"  <rb>雷</rb><rt>ルビ</rt>アタック  ");
  assert.equal(input.value.slice(input.selectionStart,input.selectionEnd),"ルビ");
  picker.handlers.click();page.pick(3);assert.equal(picker.title,"追加アイコン 3");assert.equal(picker.children[0].src,"third.png");
  assert.equal(page.latest().presentation.battler.quotes.battleStart.iconSlot,3);
  const imageInputs=page.all().filter(e=>e.tagName==="input"&&e.type==="url");
  const third=imageInputs[4];third.value="new-third.png";third.handlers.input();assert.equal(picker.children[0].src,"new-third.png");
  picker.children[0].onerror();assert.equal(picker.children[0].src,"default.png");picker.children[0].onerror();assert.equal(picker.children[0].src,FIXED_IMAGES.battlerIcon);
  third.value="";third.handlers.input();assert.equal(picker.children[0].src,"default.png");assert.equal(page.latest().presentation.battler.quotes.battleStart.iconSlot,3);
  imageInputs[1].value="new-default.png";imageInputs[1].handlers.input();assert.equal(picker.children[0].src,"new-default.png");
  picker.handlers.click();page.pick(null);assert.equal(picker.title,"デフォルトアイコン");assert.equal(picker.children[0].src,"new-default.png");
  const quote=page.latest().presentation.battler.quotes.battleStart;assert.deepEqual(Object.keys(quote),["text","iconSlot"]);
  assert.equal(quote.iconSlot,null);assert.equal(page.latest().presentation.schemaVersion,1);
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
  data.presentation.ducks={ [first.id]:{iconUrl:"first-icon.png",cutinUrl:"first-cutin.png"},[second.id]:{iconUrl:"second-icon.png",cutinUrl:"second-cutin.png"} };
  const before=structuredClone(data.build);page.hydrate(data);assert.deepEqual(page.latest().build,before);
  const editors=page.get("duck-icon-editor").children;assert.equal(editors.length,2);
  assert.equal(editors[0].hidden,false);assert.equal(editors[1].hidden,true);
  const [icon,cutin]=editors[0].children,description=cutin.children[1],field=cutin.children[2];
  assert.equal(description.textContent,presentCSkill(first.cSelection).text);
  assert.equal(field.className,"image-field cutin-field");assert.equal(field.children[0].tagName,"label");
  assert.equal(field.children[1].className,"preview cutin-preview");assert.equal(field.children[1].children.length,1); // no fallback
  const cutinInput=field.children[0].children.find(e=>e.tagName==="input");
  cutinInput.value="new-cutin.png";cutinInput.handlers.input();
  assert.deepEqual(page.latest().presentation.ducks[first.id],{iconUrl:"first-icon.png",cutinUrl:"new-cutin.png"});
  const iconInput=icon.children[1].children.find(e=>e.tagName==="input");iconInput.value="new-icon.png";iconInput.handlers.input();
  assert.deepEqual(page.latest().presentation.ducks[first.id],{iconUrl:"new-icon.png",cutinUrl:"new-cutin.png"});
  assert.deepEqual(page.latest().presentation.ducks[second.id],data.presentation.ducks[second.id]);assert.deepEqual(page.latest().build,before);
  page.get("duck-select").value=second.id;page.get("duck-select").onchange();
  assert.equal(editors[0].hidden,true);assert.equal(editors[1].hidden,false);
  assert.equal(editors[1].children[1].children[1].textContent,"Cスキル未設定");
  data.build.ducks[0].cSelection={mode:"normal",structure:{kind:"flat",effects:[null]}};page.hydrate(data);
  assert.equal(page.get("duck-icon-editor").children[0].children[1].children[1].textContent,"Cスキル設定未完了");
  assert.deepEqual(page.latest().build,data.build);
});
