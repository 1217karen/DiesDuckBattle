// Small DOM fixture for event/async state tests; it does not claim browser layout coverage.
export class Element {
 constructor(tag='div') {this.tagName=tag;this.children=[];this.handlers={};this.attrs={};this.dataset={};this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.checked=false;this.open=false;}
 append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
 replaceChildren(...nodes){for(const n of this.children)n.parent=null;this.children=[];this.append(...nodes);}
 get childNodes(){return this.children;}
 get isConnected(){return this.tagName==='document'||!!this.parent?.isConnected;}
 setAttribute(k,v){this.attrs[k]=v;if(k==='id')this.id=v;}
 getAttribute(k){return this.attrs[k];}
 addEventListener(k,f){(this.handlers[k]??=[]).push(f);}
 async fire(k){for(const f of this.handlers[k]??[])await f({preventDefault(){}});}
 focus(){this.focused=true;}
 scrollIntoView(){this.scrolled=true;}
 setCustomValidity(v){this.validityMessage=v;}
 set innerHTML(_){throw new Error('HTML injection sink');}
 matches(selector){
  if(selector.endsWith(':checked')){if(!this.checked)return false;selector=selector.slice(0,-8);}
  const tag=selector.match(/^[\w-]+/);if(tag&&tag[0]!==this.tagName)return false;
  const cls=selector.match(/\.([\w-]+)/);if(cls&&!this.className?.split(' ').includes(cls[1]))return false;
  for(const [,key,value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)){
   const actual=key==='data-feedback-write'?this.dataset.feedbackWrite:this[key]??this.attrs[key];
   if(value===undefined?actual===undefined:String(actual)!==value)return false;
  }
  return true;
 }
 querySelectorAll(selector){
  const found=[];
  const visit=n=>{for(const child of n.children){if(selector.split(',').some(s=>{
   const parts=s.trim().split(/\s+/);if(!child.matches(parts.pop()))return false;
   if(!parts.length)return true;let parent=child.parent;while(parent){if(parent.matches(parts.join(' ')))return true;parent=parent.parent;}return false;
  }))found.push(child);visit(child);}};visit(this);return found;
 }
 querySelector(s){return this.querySelectorAll(s)[0]??null;}
 reset(){for(const n of this.querySelectorAll('input, textarea'))n.value='';}
}
export function feedbackDocument(){
 const doc=new Element('document');const nodes=new Map();
 doc.createElement=tag=>new Element(tag);
 doc.getElementById=id=>nodes.get(id)??doc.querySelectorAll('div, article, h2, textarea, p').find(n=>n.id===id);
 const add=(id,tag,parent)=>{const n=new Element(tag);n.id=id;nodes.set(id,n);parent.append(n);return n;};
 const root=add('panel-reports','section',doc);
 add('feedback-new','button',root);add('feedback-auth','p',root);
 const filters=add('filters','div',root);filters.className='notice-filters';
 for(const [name,values] of [['report-type',['all','bug','request','question']],['report-status',['all','open','confirmed','resolved','withdrawn']]]){
  for(const value of values){const input=new Element('input');input.name=name;input.value=value;input.checked=value==='all';filters.append(input);}
 }
 add('report-sort','select',filters).value='newest';
 const form=add('feedback-form','form',root);form.hidden=true;const fieldset=new Element('fieldset');form.append(fieldset);
 for(const [id,tag] of [['feedback-category','select'],['feedback-title','input'],['feedback-title-count','p'],['feedback-body','textarea'],['feedback-body-count','p'],['feedback-cancel','button']])add(id,tag,fieldset);
 add('feedback-form-message','p',form);add('feedback-message','p',root);add('feedback-reload','button',root);add('feedback-list','div',root);
 return doc;
}
