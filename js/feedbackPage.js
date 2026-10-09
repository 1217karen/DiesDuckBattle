import { getAuthRuntime, getSupabaseClient } from './authRuntime.js';
import { menuModel } from './commonMenuModel.js';
import { createFeedbackService } from './feedbackService.js';
import { mountFeedbackBoard } from './feedbackView.js';

export async function startFeedbackPage() {
  const [client, controller] = await Promise.all([getSupabaseClient(),getAuthRuntime()]);
  let view, latestAuth;
  const service = createFeedbackService(client, () => {
    // Clear owner controls/drafts immediately; account resolution is owned by Auth.
    view?.sessionChanged();
    queueMicrotask(() => { if (latestAuth) view?.updateAuth(latestAuth); });
  });
  view = mountFeedbackBoard(document, service);
  const unsubscribe = controller.subscribe(state => {
    latestAuth={ready:state.ready && state.sessionKnown, signedIn:state.signedIn,
      eno:state.ready ? menuModel(state).currentAccount?.eno ?? null : null};
    view.updateAuth(latestAuth);
  });
  window.addEventListener('pagehide', () => { unsubscribe(); view.dispose(); service.dispose(); }, {once:true});
}
