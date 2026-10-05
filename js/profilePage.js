import { requireLoginPage } from "./authPageGuard.js";
import { getSupabaseClient } from "./authRuntime.js";
import { finishPageLoad } from "./pageLoad.js";
import { createOnlineProfileService, profileFailure } from "./onlineProfileService.js";
import { renderProfile } from "./profileView.js";
import { mountProfileThemeEditor } from "./profileThemeEditor.js";

export async function loadProfilePage({ document = globalThis.document, location = globalThis.location,
  requireLogin = requireLoginPage, getClient = getSupabaseClient, createService = createOnlineProfileService,
  finish = finishPageLoad } = {}) {
  await requireLogin();
  const main = document.getElementById("profile");
  const error = message => {
    const node = document.createElement("p"); node.className = "profile-error"; node.setAttribute("role", "alert");
    node.textContent = message; main.replaceChildren(node);
  };
  try {
    const eno = new URLSearchParams(location.search).get("eno");
    const client = await getClient();
    const result = await createService(client).getProfile(eno);
    if (!result.ok) { error(result.message); return result; }
    const profile = result.profile, content = renderProfile(document, profile);
    for (const [key, color] of Object.entries(profile.battler.profile.theme))
      document.body.style.setProperty(`--profile-${key === "background" ? "bg" : key}`, color);
    main.replaceChildren(content);
    if (profile.isOwner === true) mountProfileThemeEditor({ document, header: main.children[0], profile, client });
    document.title = `ENo.${profile.eno} ${profile.battler.name} | DiesDuckBattle`;
    return result;
  } catch {
    const result = profileFailure("load-failed"); error("プロフィールを表示できませんでした。" + result.message); return result;
  } finally { finish(); }
}

if (typeof document !== "undefined") await loadProfilePage();
