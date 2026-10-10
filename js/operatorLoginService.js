import { decodeFeedbackList } from './feedbackService.js';

export function createOperatorLoginService(client) {
  let busy=false, revision=0;
  const subscription=client.auth.onAuthStateChange(()=>{revision++;}).data.subscription;
  async function logout() {
    try {
      const result=await client.auth.signOut({scope:'local'});
      const session=await client.auth.getSession();
      if(result.error||session.error||session.data?.session)throw new Error('Sign out failed');
      return {ok:true};
    } catch {return {ok:false,message:'ログアウトを完了できませんでした。通信状況を確認し、ログアウトを再実行してください。'};}
  }
  return {
    async login(email,password) {
      if(busy)return {ok:false,message:'処理中です。'};
      busy=true;
      try {
        const signed=await client.auth.signInWithPassword({email:email.trim(),password});
        if(signed.error||!signed.data?.session)throw new Error('Sign in failed');
        const expected=signed.data.session, version=revision;
        const before=await client.auth.getSession();
        if(before.error||before.data?.session?.user?.id!==expected.user.id
          || before.data.session.access_token!==expected.access_token)throw new Error('Session changed');
        const result=await client.rpc('list_feedback_threads',{p_eno:null});
        const after=await client.auth.getSession();
        if(result.error||after.error||revision!==version||after.data?.session?.user?.id!==expected.user.id
          ||after.data.session.access_token!==expected.access_token||!decodeFeedbackList(result.data).isModerator)throw new Error('Not moderator');
        return {ok:true};
      } catch {
        const cleared=await logout();
        return {ok:false,message:cleared.ok?'運営権限を確認できません。':cleared.message};
      } finally {busy=false;}
    },
    logout,
    dispose(){revision++;subscription.unsubscribe();},
  };
}
