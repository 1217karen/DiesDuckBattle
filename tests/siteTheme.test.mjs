import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, readdir } from "node:fs/promises";
import { createAuthController } from "../js/authController.js";

const code = await readFile(new URL("../js/siteTheme.js", import.meta.url), "utf8");
function load(value, { readThrows=false, writeThrows=false, missing=false, getterThrows=false, themed=true }={}) {
  const writes=[], paints=[];
  const dataset=new Proxy({}, {set(target,key,value){if(key==="theme")paints.push(value);target[key]=value;return true;}});
  const context={document:{querySelector:()=>themed ? {} : null, documentElement:{dataset}}};
  if(getterThrows)Object.defineProperty(context,"localStorage",{get(){throw Error("blocked");}});
  else if(!missing)context.localStorage={
    getItem(key){assert.equal(key,"diesduck-site-theme");if(readThrows)throw Error("blocked");return value;},
    setItem(key,next){assert.equal(key,"diesduck-site-theme");if(writeThrows)throw Error("quota");value=next;writes.push([key,next]);}
  };
  vm.runInNewContext(code,context);
  return {context,writes,paints,api:context.diesDuckSiteTheme,value:()=>value};
}
for(const [stored,expected] of [[null,"light"],["dark","dark"],["light","light"],["","light"],["DARK","light"],["invalid","light"]]){
  test("synchronous initial browser preference "+JSON.stringify(stored),()=>{
    const f=load(stored);assert.equal(f.context.document.documentElement.dataset.theme,expected);
    assert.equal(f.api.read(),expected);assert.deepEqual(f.paints,[expected]);assert.deepEqual(f.writes,[]);
  });
}
test("set switches both ways immediately and persists; apply normalizes without saving",()=>{
  const f=load(null);
  for(const theme of ["dark","light"]){
    assert.equal(f.api.set(theme),theme);assert.equal(f.context.document.documentElement.dataset.theme,theme);
    assert.equal(load(f.value()).context.document.documentElement.dataset.theme,theme);
  }
  assert.deepEqual(f.writes,[["diesduck-site-theme","dark"],["diesduck-site-theme","light"]]);
  assert.equal(f.api.apply("dark"),"dark");assert.equal(f.api.apply("invalid"),"light");assert.equal(f.writes.length,2);
  assert.equal(f.api.set("invalid"),"light");assert.equal(f.value(),"light");
});
for(const options of [{readThrows:true},{writeThrows:true},{readThrows:true,writeThrows:true},{missing:true},{getterThrows:true}]){
  test("storage unavailable still permits immediate display "+JSON.stringify(options),()=>{
    const f=load(null,options);assert.equal(f.api.read(),"light");assert.equal(f.context.document.documentElement.dataset.theme,"light");
    assert.doesNotThrow(()=>f.api.set("dark"));assert.equal(f.context.document.documentElement.dataset.theme,"dark");
    assert.equal(f.api.set("light"),"light");
  });
}
test("every themed page executes the classic head script before any stylesheet",async()=>{
  const pages=(await readdir(new URL("../",import.meta.url))).filter(p=>p.endsWith(".html"));
  const checked=[];
  for(const page of pages){
    const html=await readFile(new URL("../"+page,import.meta.url),"utf8");
    if(!html.includes("css/common-theme.css"))continue;
    const script=html.indexOf('<script src="js/siteTheme.js"></script>');
    assert.ok(script>html.indexOf("<head>")&&script<html.indexOf("</head>"),page);
    const css=html.search(/<link[^>]*rel="stylesheet"/);
    assert.ok(script<css,page);assert.equal(html.split('src="js/siteTheme.js"').length,2);
    // No Auth runtime is present: dark must already be set at the first CSS boundary.
    const f=load("dark");assert.deepEqual(f.paints,["dark"]);checked.push(page);
  }
  assert.ok(checked.includes("setting.html"));assert.ok(checked.includes("character.html"));
  assert.deepEqual(Object.keys(load(null).api).sort(),["apply","read","set"]);
  assert.doesNotMatch(code,/auth|supabase|sessionStorage|presentation/i);
});
test("real Auth startup, logout and re-login never repaint or overwrite the browser theme",async()=>{
  const f=load("dark");
  const controller=createAuthController({
    watch:()=>()=>{},session:async()=>null,accounts:async()=>[],
    login:async()=>({ok:true,session:{user:{id:"user"}}}),logout:async()=>{}
  },()=>{});
  await controller.start();await controller.login("1","test-password");await controller.logout();await controller.login("1","test-password");
  assert.deepEqual(f.paints,["dark"]);assert.equal(f.value(),"dark");assert.deepEqual(f.writes,[]);
  controller.stop();
});

test("radio CSS overrides generic full-width and minimum-height inputs in its own scope", async () => {
  const css = await readFile(new URL("../css/common-menu.css", import.meta.url), "utf8");
  assert.match(css, /\.common-menu__theme-options\s*\{[^}]*display:flex/);
  assert.match(css, /\.common-menu__theme-options label\s*\{[^}]*display:flex/);
  assert.match(css, /\.common-menu__theme-options input\[type="radio"\]\s*\{[^}]*width:20px[^}]*height:20px[^}]*min-height:20px/);
});

test("menu module reuses head initialization without repainting; non-themed pages only store preferences",()=>{
 const themed=load("dark"),api=themed.api;
 vm.runInNewContext(code,themed.context);assert.equal(themed.context.diesDuckSiteTheme,api);assert.deepEqual(themed.paints,["dark"]);
 const plain=load("dark",{themed:false});plain.api.set("light");plain.api.set("dark");
 assert.deepEqual(plain.paints,[]);assert.equal(plain.value(),"dark");assert.equal(load(plain.value()).context.document.documentElement.dataset.theme,"dark");
});
test("independent page designs do not opt in to page themes",async()=>{
 for(const page of ["index.html","select.html","profile.html"]){const html=await readFile(new URL("../"+page,import.meta.url),"utf8");assert.doesNotMatch(html,/css\/common-theme.css|src="js\/siteTheme.js"/);}
});
