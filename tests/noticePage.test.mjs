import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {notices} from '../js/noticeData.js';
import {Element} from './feedbackDomFixture.mjs';

test('static notices and index, deep links and keyboard tabs remain independent of board/network',async()=>{
 const document=new Element('document');document.createElement=tag=>new Element(tag);
 const nodes=new Map();for(const id of ['notice-articles','notice-index','panel-notices','panel-reports']){const n=new Element('div');n.id=id;nodes.set(id,n);document.append(n);}
 const tabs=['panel-notices','panel-reports'].map(id=>{const n=new Element('button');n.setAttribute('aria-controls',id);return n;});
 document.querySelectorAll=()=>tabs;
 document.getElementById=id=>nodes.get(id)??nodes.get('notice-articles').children.find(n=>n.id===id);
 const events={},location={hash:'#'+notices[1].id};let finished=false;
 let code=await readFile(new URL('../js/noticePage.js',import.meta.url),'utf8');
 // Only replace module loading; run the entire production notice renderer/tab handlers.
 code=code.replace(/^import .*;\r?\n/gm,'').replace(/void import\("\.\/feedbackPage\.js"\)[\s\S]*$/,'');
 location.search='?tab=reports';
 vm.runInNewContext(code,{document,notices,location,URLSearchParams,window:{addEventListener:(key,fn)=>events[key]=fn},finishPageLoad(){finished=true;}});
 assert.ok(finished);assert.equal(nodes.get('notice-articles').children.length,notices.length);assert.equal(nodes.get('notice-index').children.length,notices.length);
 for(const [i,notice] of notices.entries()){
  const article=nodes.get('notice-articles').children[i],link=nodes.get('notice-index').children[i];
  assert.equal(article.id,notice.id);assert.equal(article.children[1].textContent,notice.title);
  assert.deepEqual(article.children[2].children.map(n=>n.textContent),notice.body);assert.equal(link.attrs.href,'#'+encodeURIComponent(notice.id));
 }
 assert.ok(document.getElementById(notices[1].id).scrolled);assert.equal(nodes.get('panel-reports').hidden,true);
 await tabs[1].fire('click');assert.equal(nodes.get('panel-notices').hidden,true);
 location.hash='#'+notices[2].id;events.hashchange();assert.equal(nodes.get('panel-notices').hidden,false);
 for(const fn of tabs[0].handlers.keydown)fn({key:'ArrowRight',preventDefault(){}});
 assert.equal(nodes.get('panel-reports').hidden,false);assert.ok(tabs[1].focused);
 location.hash='';vm.runInNewContext(code,{document,notices,location,URLSearchParams,window:{addEventListener(){}},finishPageLoad(){}});
 assert.equal(nodes.get('panel-reports').hidden,false);
 const html=await readFile(new URL('../notice.html',import.meta.url),'utf8');assert.ok(html.includes('id="notice-articles"'));assert.ok(!html.includes('PL名検索'));
 const index=await readFile(new URL('../index.html',import.meta.url),'utf8');assert.ok(index.includes('href="notice.html"'));
});
