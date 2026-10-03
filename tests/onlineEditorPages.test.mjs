import { FIXED_IMAGES } from "../js/fixedImages.js";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createAuthController } from "../js/authController.js";
import { createOnlineEditController } from "../js/onlineEditController.js";
import { createEmptyPlayerPresentation } from "../js/playerPresentationModel.js";
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
  const context = { FIXED_IMAGES, document, structuredClone, createEmptyPlayerPresentation, IMAGE_LIMITS, createImageValidation, imageValidationSummary,
    Option: function (name, value) { const el = new Element("option"); el.textContent = name; el.value = value; return el; },
    createIconPicker: () => ({ open(args) { selectedCallback = args.select; }, close() { selectedCallback = null; } }),
    mountOnlineEditor: async args => { assert.deepEqual(Array.from(args.sections), ["presentation", "battlerName"]); hooks = args; latest = structuredClone(data); args.hydrate(data); args.onState({ canSave: true, canEdit: true }); return controller; } };
  await vm.runInNewContext(`(async()=>{${await source("characterPage")}})()`, context);
  return { get, all, data, latest: () => latest, saved: () => saved, hydrate(data) { latest = structuredClone(data); hooks.hydrate(data); hooks.onState({ canSave: true, canEdit: true }); },
    pick(slot) { selectedCallback(slot); }, save: () => get("save").handlers.click(), controller };
}
test("actual character handlers preserve full DTO, quotes, ten icon slots, detached Duck URLs and image validation gates", async () => {
  const page = await characterScreen();
  const inputs = () => page.all().filter(el => el.tagName === "input");
  assert.equal(inputs().length, 14); // standing/default/10 slots/build Duck/detached Duck
  assert.equal(page.get("save").disabled, true); await page.save(); assert.equal(page.saved(), undefined);
  let image = page.all().find(el => el.tagName === "img" && el.src === "https://example.invalid/orphan.png");
  image.naturalWidth = 251; image.naturalHeight = 1; image.onload(); assert.equal(page.get("save").disabled, true);
  const orphanInput = inputs().at(-1); orphanInput.value = "https://example.invalid/fixed.png"; orphanInput.handlers.input();
  image = page.all().find(el => el.tagName === "img" && el.src === orphanInput.value);
  image.naturalWidth = 20; image.naturalHeight = 20; image.onload(); assert.equal(page.get("save").disabled, false);
  const slot10 = inputs()[11]; slot10.value = "https://example.invalid/slot10.png"; slot10.handlers.input();
  image = page.all().find(el => el.tagName === "img" && el.src === slot10.value); image.naturalWidth = 250; image.naturalHeight = 250; image.onload();
  const quote = page.all().find(el => el.tagName === "textarea"); quote.value = "オンラインセリフ"; quote.handlers.input();
  page.all().find(el => el.className === "quote-picker").handlers.click(); page.pick(10);
  const beforeRename = structuredClone(page.latest().presentation);
  page.get("battler-name").value = "変更後のバトラー"; page.get("battler-name").handlers.input();
  assert.deepEqual(page.latest().presentation, beforeRename);
  await page.save();
  const saved = page.saved(); assert.deepEqual(saved.build, page.data.build); assert.deepEqual(saved.publicSettings, page.data.publicSettings); assert.equal(saved.battlerName, "変更後のバトラー");
  assert.equal(saved.presentation.battler.iconSlots[9], slot10.value); assert.deepEqual(saved.presentation.battler.quotes.battleStart, { text: quote.value, iconSlot: 10 });
  assert.equal(saved.presentation.ducks.orphan.iconUrl, orphanInput.value);
  page.hydrate(saved); assert.equal(page.get("battler-name").value, "変更後のバトラー"); assert.equal(page.all().find(el => el.tagName === "textarea").value, "オンラインセリフ");
  assert.equal(page.all().find(el => el.className === "quote-picker").textContent, "追加 10");
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
