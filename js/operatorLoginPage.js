import { getSupabaseClient } from './authRuntime.js';
import { createOperatorLoginService } from './operatorLoginService.js';

const form=document.getElementById('operator-form'),fields=document.getElementById('operator-fields');
const logout=document.getElementById('operator-logout'),message=document.getElementById('operator-message');
const password=document.getElementById('operator-password');
try {
  const client=await getSupabaseClient(),service=createOperatorLoginService(client);
  let busy=false;
  const lock=value=>{busy=value;fields.disabled=value;logout.disabled=value;};
  lock(false);message.textContent='';
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;lock(true);message.textContent='運営権限を確認中…';
    const pending=service.login(document.getElementById('operator-email').value,password.value);
    password.value='';
    const result=await pending;
    if(result.ok){location.replace('notice.html?tab=reports');return;}
    message.textContent=result.message;lock(false);
  });
  logout.addEventListener('click',async()=>{
    if(busy)return;lock(true);password.value='';const result=await service.logout();
    message.textContent=result.ok?'ログアウトしました。':result.message;lock(false);
  });
  window.addEventListener('pagehide',()=>service.dispose(),{once:true});
} catch {message.textContent='ログイン機能を読み込めませんでした。ページを再読み込みしてください。';}
