import { getAuthRuntime } from "./authRuntime.js";
import { mountAuthView } from "./authView.js";

const root = document.getElementById("auth-root");
try {
  const controller = await getAuthRuntime();
  mountAuthView(root, controller);
} catch {
  root.textContent = "認証機能を読み込めませんでした。通信状況を確認して再読み込みしてください。";
}
