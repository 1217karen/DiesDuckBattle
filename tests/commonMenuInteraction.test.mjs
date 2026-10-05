import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { menuModel } from "../js/commonMenuModel.js";

const code = (await readFile(new URL("../js/commonMenu.js", import.meta.url), "utf8")).replace(/^import .*;\r?\n/gm, "");
const signed = { ready:true, sessionKnown:true, signedIn:true, accountsResolved:true,
  accounts:[{ eno:"2", name:"キャラ名", id:"game-account-uuid" }], enos:["2"], sessionMessage:"" };
async function screen(cached = null) {
  const document = { activeElement:null, handlers:{}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  class Element {
    constructor(tag) { this.tagName=tag; this.children=[]; this.handlers={}; this.attributes={}; this.open=false; this.textContent=""; this.isConnected=true; this.replacements=0; }
    addEventListener(type, handler) { this.handlers[type]=handler; }
    setAttribute(key,value) { this.attributes[key]=value; }
    removeAttribute(key) { delete this.attributes[key]; }
    replaceChildren(...items) { this.children.forEach(item=>{item.isConnected=false;}); this.children=items; this.replacements++; }
    append(item) { this.children.push(item); }
    contains(item) { return this===item || this.children.some(child=>child.contains(item)); }
    focus() { document.activeElement=this; }
  }
  const root=new Element("header"), nav=new Element("nav"), accountMenu=new Element("div"), identity=new Element("span"), feedback=new Element("p"), arrow=new Element("span");
  const left=new Element("details"), right=new Element("details"), leftTrigger=new Element("summary"), rightTrigger=new Element("summary");
  left.children=[leftTrigger,nav]; right.children=[rightTrigger,accountMenu,feedback]; rightTrigger.children=[identity,arrow]; root.children=[left,right];
  const nodes=new Map([[".common-menu__nav",left],[".common-menu__account",right],["nav",nav],["[data-account-menu]",accountMenu],["[data-identity]",identity],["[data-feedback]",feedback],["[data-account-arrow]",arrow]]);
  root.querySelector=selector=>nodes.get(selector); left.querySelector=()=>leftTrigger; right.querySelector=()=>rightTrigger;
  document.getElementById=()=>root; document.createElement=tag=>new Element(tag);
  let render, logoutCalls=0;
  const controller={subscribe(fn){render=fn;}, async logout(){logoutCalls++;}};
  await vm.runInNewContext(`(async()=>{${code}})()`,{document,location:{replace(){}},menuModel,displayCache:{read:()=>cached},getAuthRuntime:async()=>controller});
  const toggle=(details)=>{details.open=true;details.handlers.toggle();};
  return {document,root,left,right,leftTrigger,rightTrigger,nav,accountMenu,identity,render,toggle,logoutCalls:()=>logoutCalls};
}

test("navigation and account controls stay separate; logout uses existing controller and disables while busy", async()=>{
  const s=await screen(); s.render(signed);
  assert.equal(s.identity.textContent,"ENo.2｜キャラ名");
  assert.equal(s.nav.children.some(item=>item.tagName==="button"),false);
  assert.deepEqual(s.accountMenu.children.map(item=>item.textContent),["自分のプロフィールを確認する","ログアウト"]);
  assert.equal(s.accountMenu.children[0].attributes.href,"profile.html?eno=2");
  s.toggle(s.left); assert.equal(s.left.open,true); assert.equal(s.right.open,false);
  s.toggle(s.right); assert.equal(s.right.open,true); assert.equal(s.left.open,false);
  s.toggle(s.left); assert.equal(s.right.open,false);
  await s.accountMenu.children[1].handlers.click(); assert.equal(s.logoutCalls(),1);
  const button=s.accountMenu.children[1];
  s.render({...signed,busy:"logout"}); assert.equal(button.disabled,true);
  s.render({...signed,busy:""}); assert.equal(button.disabled,false);
});

test("outside click closes both menus; inside click stays open; Escape returns focus to either trigger", async()=>{
  const s=await screen();s.render(signed);
  for(const [details,trigger] of [[s.left,s.leftTrigger],[s.right,s.rightTrigger]]) {
    s.toggle(details); s.document.handlers.click({target:trigger});assert.equal(details.open,true);
    let prevented=false;
    s.document.handlers.keydown({key:"Escape",preventDefault(){prevented=true;}});
    assert.equal(details.open,false);assert.equal(s.document.activeElement,trigger);assert.equal(prevented,true);
    s.toggle(details);s.document.handlers.click({target:{}});assert.equal(s.left.open,false);assert.equal(s.right.open,false);
  }
});

test("profile uses exact string ENo; multiple/unknown/guest states never infer an owner",async()=>{
  const s=await screen();s.render({...signed,accounts:[{eno:"9223372036854775807",name:"大きなENo",id:"uuid"}]});
  assert.equal(s.accountMenu.children[0].attributes.href,"profile.html?eno=9223372036854775807");
  for(const state of [{...signed,accounts:[{eno:"2"},{eno:"5"}],enos:["2","5"]},
    {...signed,accountsResolved:false}, {...signed,accounts:[]}, {...signed,accounts:[{eno:"uuid"}]}]) {
    s.render(state);assert.equal(s.accountMenu.children[0].hidden,true);assert.equal(s.accountMenu.children[0].attributes.href,undefined);
  }
  s.render({...signed,signedIn:false,accounts:[],enos:[]});assert.equal(s.identity.textContent,"未ログイン");assert.equal(s.accountMenu.children.length,0);
  let prevented=false;s.rightTrigger.handlers.click({preventDefault(){prevented=true;}});assert.equal(prevented,true);
  s.toggle(s.right);assert.equal(s.right.open,false);assert.equal(s.rightTrigger.attributes.tabindex,"-1");
});

test("cache retains restore display without profile inference; refresh/name update preserves focused account and navigation nodes",async()=>{
  const s=await screen({loggedIn:true,identity:"ENo.99｜キャッシュ"});
  s.render({...signed,ready:false,sessionKnown:false,signedIn:false,accounts:[],accountsResolved:false});
  assert.equal(s.identity.textContent,"ENo.99｜キャッシュ");assert.equal(s.accountMenu.children[0].hidden,true);
  s.render({...signed,ready:false,accounts:[],accountsResolved:false});assert.equal(s.accountMenu.children[0].attributes.href,undefined);
  s.render(signed);
  const profile=s.accountMenu.children[0],logout=s.accountMenu.children[1],navLink=s.nav.children[0];
  profile.focus();s.render({...signed,accounts:[{eno:"2",name:"更新名"}]});s.render(signed);
  assert.equal(s.document.activeElement,profile);assert.equal(s.accountMenu.children[0],profile);assert.equal(s.accountMenu.children[1],logout);assert.equal(s.nav.children[0],navLink);
  logout.focus();s.render({...signed,busy:"logout"});assert.equal(s.document.activeElement,logout);
  assert.equal(s.accountMenu.replacements,1);
});

test("black bar protects hamburger width, ellipsis identity and right anchored bounded dropdown",async()=>{
  const css=await readFile(new URL("../css/common-menu.css",import.meta.url),"utf8");
  assert.match(css,/common-menu__nav\s*\{[^}]*flex:0 0 auto/);
  assert.match(css,/common-menu__account\s*\{[^}]*min-width:0[^}]*max-width:calc\(100% - 60px\)/);
  assert.match(css,/\[data-identity\][^{]*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(css,/common-menu__account-dropdown\s*\{\s*right:0/);
  assert.doesNotMatch(css,/common-menu__label/);
});
