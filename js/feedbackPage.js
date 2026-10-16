import { getAuthRuntime, getSupabaseClient } from './authRuntime.js';
import { menuModel } from './commonMenuModel.js';
import { createFeedbackService } from './feedbackService.js';
import { mountFeedbackBoard } from './feedbackView.js';
import { getOperatorSupabaseClient } from './supabaseClients.js';
import { ACCOUNT_SWITCHING_ENABLED } from './accountSwitchingConfig.js';

export async function startFeedbackPage() {
  const operator = ACCOUNT_SWITCHING_ENABLED && new URLSearchParams(location.search).get('operator') === '1';
  const [client, controller] = await Promise.all([operator ? getOperatorSupabaseClient() : getSupabaseClient(),getAuthRuntime()]);
  let view, latestAuth;
  const service = createFeedbackService(client, () => {
    // Clear owner controls/drafts immediately; account resolution is owned by Auth.
    view?.sessionChanged();
    queueMicrotask(() => { if (latestAuth) view?.updateAuth(latestAuth); });
  });
  view = mountFeedbackBoard(document, service);
  const stopGuard = controller.beforeLogout(context => view.canLeave(context));
  const unsubscribe = controller.subscribe(state => {
    latestAuth=operator ? {ready:true,signedIn:true,eno:null} : {ready:state.ready && state.sessionKnown, signedIn:state.signedIn,
      eno:state.ready ? menuModel(state).currentAccount?.eno ?? null : null};
    view.updateAuth(latestAuth);
  });
  window.addEventListener('pagehide', () => { stopGuard(); unsubscribe(); view.dispose(); service.dispose(); }, {once:true});
}
