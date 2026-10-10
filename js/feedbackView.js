import { FEEDBACK_TITLE_MAX, FEEDBACK_BODY_MAX, FEEDBACK_CATEGORIES, FEEDBACK_STATUSES,
  codePointLength, selectFeedback, validateFeedbackInput } from './feedbackService.js';

export function mountFeedbackBoard(document, service, confirm = message => globalThis.confirm(message)) {
  const get = id => document.getElementById(id);
  const root=get('panel-reports'), list=get('feedback-list'), message=get('feedback-message');
  const form=get('feedback-form'), newButton=get('feedback-new'), authMessage=get('feedback-auth');
  let auth={ready:false,signedIn:false,eno:null}, data={threads:[],canPost:false,isModerator:false};
  let epoch=0, loadVersion=0, busy=false, disposed=false, authKey='';
  const expanded=new Set(), drafts=new Map(), replies=new Map();
  const el=(tag,cls,text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
  const button=(label,click,permission) => {
    const n=el('button','',label); n.type='button'; n.addEventListener('click',click);
    if(permission)n.dataset.feedbackWrite=permission;
    return n;
  };
  const canUserWrite=()=>auth.ready && auth.signedIn && !!auth.eno && data.canPost;
  const canModerate=()=>auth.ready && auth.signedIn && data.isModerator;
  const canReply=thread=>canModerate() || (canUserWrite() && thread.status!=='withdrawn');
  const dateNode=value => {const n=el('time','feedback-date',new Date(value).toLocaleString('ja-JP')); n.dateTime=value;return n;};
  function enabled() {
    newButton.disabled=busy || !canUserWrite();
    form.querySelector('fieldset').disabled=busy || !canUserWrite();
    for(const n of root.querySelectorAll('[data-feedback-write]')) n.disabled=busy || n.dataset.feedbackClosed==='true' || !(n.dataset.feedbackWrite==='moderator'?canModerate():n.dataset.feedbackWrite==='reply'?(canModerate()||canUserWrite()):canUserWrite());
    authMessage.textContent=canModerate()?'運営としてログイン中':!auth.ready?'ログイン状態を確認中です。':!auth.signedIn?'閲覧はどなたでも可能です。投稿・返信・同意にはホームからログインしてください。':!auth.eno?'利用できるゲームアカウントを確認できません。':'投稿後の編集・削除はできません。補足は返信で追加してください。';
  }
  function countInput(input, output, max) {
    const update=()=>{const n=codePointLength(input.value);output.textContent=`${n} / ${max}文字`;input.setCustomValidity(n>max?`${max}文字以内で入力してください。`:'');};
    input.addEventListener('input',update);update();return update;
  }
  const titleCount=countInput(get('feedback-title'),get('feedback-title-count'),FEEDBACK_TITLE_MAX);
  const bodyCount=countInput(get('feedback-body'),get('feedback-body-count'),FEEDBACK_BODY_MAX);
  function closeForm() { form.hidden=true;newButton.setAttribute('aria-expanded','false'); }
  newButton.addEventListener('click',()=>{if(!canUserWrite()||busy)return;form.hidden=false;newButton.setAttribute('aria-expanded','true');get('feedback-category').focus();});
  get('feedback-cancel').addEventListener('click',()=>{closeForm();newButton.focus();});

  async function load() {
    const version=++loadVersion, current=epoch;
    message.textContent='読み込み中…';
    const result=await service.list(auth.ready && auth.signedIn ? auth.eno : null);
    if(disposed||current!==epoch||version!==loadVersion)return;
    if(!result.ok) { message.textContent=result.stale?'ログイン状態が変わりました。再読み込みしてください。':result.message;return; }
    data=result.data;replies.clear();message.textContent='';render();enabled();
  }
  async function mutate(action, success, output=message) {
    if(busy)return;
    const current=epoch;busy=true;enabled();output.textContent='送信中…';
    try {
      const result=await action();
      if(disposed||current!==epoch)return;
      if(!result.ok){output.textContent=result.stale?'ログイン状態が変わりました。再読み込みしてください。':result.message;return;}
      output.textContent='';await success(result.data);
    } finally {if(current===epoch){busy=false;enabled();}}
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();if(!canUserWrite()||busy)return;
    const input={category:get('feedback-category').value,title:get('feedback-title').value,body:get('feedback-body').value};
    try {validateFeedbackInput(input);} catch {get('feedback-form-message').textContent='種別・タイトル・本文と文字数を確認してください。';return;}
    void mutate(()=>service.create(auth.eno,input),async()=>{
      form.reset();titleCount();bodyCount();closeForm();
      root.querySelector('input[name="report-type"][value="all"]').checked=true;
      root.querySelector('input[name="report-status"][value="all"]').checked=true;
      get('report-sort').value='newest';await load();
    },get('feedback-form-message'));
  });
  get('feedback-reload').addEventListener('click',()=>{if(!busy)void load();});
  for(const control of root.querySelectorAll('.notice-filters input, .notice-filters select')) control.addEventListener('change',render);

  async function showReplies(thread, container) {
    const current=epoch, version=loadVersion;
    container.replaceChildren(el('p','notice-side-help','返信を読み込み中…'));
    let result=replies.get(thread.id);
    if(!result)result=await service.replies(thread.id);
    if(disposed||current!==epoch||version!==loadVersion||!container.isConnected)return;
    if(!result.ok){container.replaceChildren(el('p','',result.message || 'ログイン状態が変わりました。'),button('返信を再読み込み',()=>void showReplies(thread,container)));return;}
    replies.set(thread.id,result);container.replaceChildren();
    for(const reply of result.data){
      const row=el('div','feedback-reply');
      const meta=el('div','notice-meta');meta.append(dateNode(reply.createdAt));
      if(reply.isAuthor)meta.append(el('span','notice-badge','投稿者'));
      if(reply.isModerator)meta.append(el('span','notice-badge','運営'));
      row.append(meta,el('p','feedback-text',reply.body));
      if(canModerate())row.append(button('この返信を非表示',()=>{
        if(confirm('この返信を運営非表示にしますか？'))void mutate(()=>service.hide(thread.id,reply.id),load);
      },'moderator'));
      container.append(row);
    }
    if(!result.data.length)container.append(el('p','notice-side-help','まだ返信はありません。'));
    if(thread.status==='withdrawn'&&!canModerate()){container.append(el('p','notice-side-help','取り下げ済みのため、返信・同意の変更はできません。'));return;}
    if(!canReply(thread)){container.append(el('p','notice-side-help','返信にはログインとゲームアカウントが必要です。'));return;}
    const replyForm=el('form','feedback-reply-form'),label=el('label','','返信本文'),input=el('textarea');
    input.id='reply-input-'+thread.id;label.htmlFor=input.id;input.rows=4;input.required=true;
    input.value=drafts.get(thread.id) ?? '';input.addEventListener('input',()=>drafts.set(thread.id,input.value));
    const counter=el('p','feedback-count');counter.id='reply-count-'+thread.id;input.setAttribute('aria-describedby',counter.id);countInput(input,counter,FEEDBACK_BODY_MAX);
    const feedback=el('p');feedback.setAttribute('role','status');
    const submit=button('返信を投稿',()=>{},'reply');submit.type='submit';
    replyForm.append(label,input,counter,submit,feedback);replyForm.hidden=!drafts.has(thread.id);
    const opener=button('返信を書く',()=>{replyForm.hidden=false;input.focus();},'reply');
    replyForm.addEventListener('submit',event=>{
      event.preventDefault();if(!canReply(thread)||busy)return;
      try{validateFeedbackInput({body:input.value},true);}catch{feedback.textContent='本文を1〜2000文字で入力してください。';return;}
      void mutate(()=>service.reply(auth.eno,thread.id,input.value),async()=>{drafts.delete(thread.id);await load();},feedback);
    });
    container.append(opener,replyForm);enabled();
  }
  function render() {
    const category=root.querySelector('input[name="report-type"]:checked').value;
    const status=root.querySelector('input[name="report-status"]:checked').value;
    const rows=selectFeedback(data.threads,category,status,get('report-sort').value);
    list.replaceChildren();
    if(!rows.length)list.append(el('p','notice-side-help',data.threads.length?'条件に一致する投稿はありません。':'まだ投稿はありません。'));
    for(const thread of rows){
      const card=el('article','report-card page-panel');card.id='feedback-'+thread.id;
      const meta=el('div','notice-meta');meta.append(el('span','notice-badge',FEEDBACK_CATEGORIES[thread.category]),dateNode(thread.createdAt));
      card.append(meta,el('h2','',thread.title),el('p','feedback-text',thread.body));
      const footer=el('div','report-meta');
      const reaction=button(`👍 ${thread.reactionCount}`,()=>{
        if(!canUserWrite()||thread.status==='withdrawn')return;
        void mutate(()=>service.react(auth.eno,thread.id),async value=>{
        Object.assign(thread,value);render();
        });
      },'account');
      reaction.dataset.feedbackClosed=String(thread.status==='withdrawn');
      reaction.setAttribute('aria-pressed',String(thread.hasReacted));reaction.setAttribute('aria-label',`同意 ${thread.reactionCount}件${thread.hasReacted?'（同意済み）':''}`);
      reaction.title=thread.status==='withdrawn'?'取り下げ済みのため、同意の変更はできません。':canUserWrite()?'同意する／解除する':'同意にはログインとゲームアカウントが必要です。';
      footer.append(reaction,el('span','report-status',FEEDBACK_STATUSES[thread.status]));card.append(footer);
      const operations=el('div','feedback-actions');
      if(canUserWrite()&&thread.isOwn&&['open','confirmed'].includes(thread.status))operations.append(button('取り下げる',()=>{
        if(confirm('投稿を取り下げますか？ 本文・返信・同意は記録として残り、元に戻すことはできません。'))void mutate(()=>service.withdraw(auth.eno,thread.id),load);
      },'account'));
      if(canModerate()){
        if(thread.status!=='withdrawn'){
          const select=el('select');select.setAttribute('aria-label','運営：投稿の状態');select.dataset.feedbackWrite='moderator';
          for(const value of ['open','confirmed','resolved']){const option=el('option','',FEEDBACK_STATUSES[value]);option.value=value;select.append(option);}select.value=thread.status;
          operations.append(select,button('状態を変更',()=>void mutate(()=>service.status(thread.id,select.value),load),'moderator'));
        }
        operations.append(button('投稿を非表示',()=>{if(confirm('この投稿と返信を公開一覧から非表示にしますか？'))void mutate(()=>service.hide(thread.id),load);},'moderator'));
      }
      card.append(operations);
      const details=el('details','feedback-replies'),summary=el('summary'),container=el('div','feedback-replies-body');
      const summaryText=()=>{summary.textContent=`${details.open?'返信を閉じる':'返信を見る'} ${thread.replyCount}`;};
      details.open=expanded.has(thread.id);summaryText();details.append(summary,container);
      details.addEventListener('toggle',()=>{
        if(!details.isConnected)return;
        summaryText();if(details.open){expanded.add(thread.id);if(!container.childNodes.length)void showReplies(thread,container);}else expanded.delete(thread.id);
      });
      card.append(details);list.append(card);
      if(details.open)void showReplies(thread,container);
    }
    enabled();
  }
  function reset() {
    epoch++;loadVersion++;service.invalidate();busy=false;data={threads:[],canPost:false,isModerator:false};
    expanded.clear();drafts.clear();replies.clear();list.replaceChildren();closeForm();form.reset();titleCount();bodyCount();
    get('feedback-form-message').textContent='';message.textContent='';enabled();
  }
  return {
    updateAuth(next) {
      if(disposed)return;
      const key=JSON.stringify(next);auth=next;
      if(key!==authKey){authKey=key;reset();if(next.ready)void load();}
      enabled();
    },
    sessionChanged() {
      if(disposed)return;
      reset();authKey='';auth={ready:false,signedIn:false,eno:null};enabled();
      // The entry module reapplies the latest confirmed Auth controller state.
    },
    dispose(){disposed=true;epoch++;},
  };
}
