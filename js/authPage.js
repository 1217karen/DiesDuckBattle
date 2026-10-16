import { finishPageLoad } from "./pageLoad.js";
import { getAuthRuntime } from "./authRuntime.js";
import { mountAuthView } from "./authView.js";
import { canonicalEno } from "../supabase/functions/_shared/internal-email.mjs";

const root = document.getElementById("auth-root");
try {
  const controller = await getAuthRuntime();
  mountAuthView(root, controller, {
    registrationToast: false,
    onRegistrationSuccess({ eno }) {
      location.replace("index.html?notice=registered&eno=" + encodeURIComponent(canonicalEno(eno)));
    },
  });
  controller.subscribe(state => {
    if (!state.ready) return;
    if (!state.sessionKnown) root.textContent = "認証機能を読み込めませんでした。通信状況を確認して再読み込みしてください。";
    finishPageLoad();
  });
} catch {
  root.textContent = "認証機能を読み込めませんでした。通信状況を確認して再読み込みしてください。";
  finishPageLoad();
}
