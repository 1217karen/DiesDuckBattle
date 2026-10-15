import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {notices} from '../js/noticeData.js';
import {Element} from './feedbackDomFixture.mjs';

test('static notices and index, deep links and keyboard tabs remain independent of board/network',async()=>{
 let reads=0; const noticeReadState={markRead(){reads++;}};
 const document=new Element('document');document.createElement=tag=>new Element(tag);
 const nodes=new Map();for(const id of ['notice-articles','notice-index','panel-notices','panel-reports','notice-index-disclosure','notice-filter-disclosure']){const n=new Element('div');n.id=id;nodes.set(id,n);document.append(n);}
 const tabs=['panel-notices','panel-reports'].map(id=>{const n=new Element('button');n.setAttribute('aria-controls',id);return n;});
 document.querySelectorAll=()=>tabs;
 document.getElementById=id=>nodes.get(id)??nodes.get('notice-articles').children.find(n=>n.id===id);
 let resize;const media={matches:true,addEventListener(name,fn){assert.equal(name,'change');resize=fn;}};
 const events={},location={hash:'#'+notices[1].id};let finished=false;
 let code=await readFile(new URL('../js/noticePage.js',import.meta.url),'utf8');
 // Only replace module loading; run the entire production notice renderer/tab handlers.
 code=code.replace(/^import .*;\r?\n/gm,'').replace(/void import\("\.\/feedbackPage\.js"\)[\s\S]*$/,'');
 location.search='?tab=reports';
 vm.runInNewContext(code,{document,notices,noticeReadState,location,URLSearchParams,window:{matchMedia:()=>media,addEventListener:(key,fn)=>events[key]=fn},finishPageLoad(){finished=true;}});
 assert.equal(nodes.get("notice-index-disclosure").open,false);assert.equal(nodes.get("notice-filter-disclosure").open,false);
 assert.equal(reads,1);
 assert.ok(finished);assert.equal(nodes.get('notice-articles').children.length,notices.length);assert.equal(nodes.get('notice-index').children.length,notices.length);
 for(const [i,notice] of notices.entries()){
  const article=nodes.get('notice-articles').children[i],link=nodes.get('notice-index').children[i];
  assert.equal(article.id,notice.id);assert.equal(article.children[1].textContent,notice.title);
  assert.deepEqual(article.children[2].children.map(n=>n.textContent),notice.body);assert.equal(link.attrs.href,'#'+encodeURIComponent(notice.id));
 }
 assert.ok(document.getElementById(notices[1].id).scrolled);assert.equal(nodes.get('panel-reports').hidden,true);
 nodes.get('notice-index-disclosure').open=true;
 const firstLink=nodes.get('notice-index').children[0];await firstLink.fire('click');
 assert.equal(nodes.get('notice-index-disclosure').open,false);assert.equal(location.hash,'#'+notices[0].id);assert.ok(document.getElementById(notices[0].id).focused);
 nodes.get('notice-filter-disclosure').open=true;await tabs[1].fire('click');assert.equal(nodes.get('notice-filter-disclosure').open,true);
 media.matches=false;resize();assert.equal(nodes.get('notice-index-disclosure').open,true);assert.equal(nodes.get('notice-filter-disclosure').open,true);
 media.matches=true;resize();assert.equal(nodes.get('notice-index-disclosure').open,false);assert.equal(nodes.get('notice-filter-disclosure').open,false);
 await tabs[1].fire('click');assert.equal(nodes.get('panel-notices').hidden,true);
 location.hash='#'+notices[2].id;events.hashchange();assert.equal(nodes.get('panel-notices').hidden,false);
 for(const fn of tabs[0].handlers.keydown)fn({key:'ArrowRight',preventDefault(){}});
 assert.equal(nodes.get('panel-reports').hidden,false);assert.ok(tabs[1].focused);
 const beforeReports=reads;
 location.hash='';vm.runInNewContext(code,{document,notices,noticeReadState,location,URLSearchParams,window:{matchMedia:()=>media,addEventListener(){}},finishPageLoad(){}});
 assert.equal(nodes.get('panel-reports').hidden,false);assert.equal(reads,beforeReports);
 location.search='';vm.runInNewContext(code,{document,notices,noticeReadState,location,URLSearchParams,window:{matchMedia:()=>media,addEventListener(){}},finishPageLoad(){}});assert.equal(reads,beforeReports+1);
 const html=await readFile(new URL('../notice.html',import.meta.url),'utf8');assert.ok(html.includes('id="notice-articles"'));assert.ok(!html.includes('PL名検索'));
 const index=await readFile(new URL('../index.html',import.meta.url),'utf8');assert.ok(index.includes('href="notice.html"'));
});
