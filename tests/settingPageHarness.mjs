import { readFile } from "node:fs/promises";
import { createEmptyPlayerPresentation } from "../js/playerPresentationModel.js";

// Replace only the browser connection boundary. All production editor handlers/catalogs run unchanged.
export async function loadSettingPage(build, onSave) {
  const file = new URL("../js/settingPage.js", import.meta.url);
  globalThis.__mountSettingForTest = async ({ hydrate, onState }) => {
    let data = { build: structuredClone(build), presentation: createEmptyPlayerPresentation(),
      publicSettings: { schemaVersion: 1, publicDuckId: null }, battlerName: "mock DB name" };
    let dirty = false;
    const emit = () => {
      document.getElementById("save-message").textContent = dirty ? "未保存の変更があります" : "変更はありません";
      onState({ dirty, canSave: true, canEdit: true });
    };
    hydrate(data); emit();
    return {
      snapshot: () => ({ canSave: true, canEdit: true }),
      edit(patch) { data = { ...data, ...structuredClone(patch) }; dirty = true; emit(); },
      save() { onSave(structuredClone(data.build)); dirty = false; emit(); return { ok: true }; },
    };
  };
  let source = await readFile(file, "utf8");
  source = source.replace('import { mountOnlineEditor } from "./onlineEditor.js";', 'const mountOnlineEditor = globalThis.__mountSettingForTest;');
  source = source.replace(/from "(\.\/[^\"]+)"/g, (_, path) => `from ${JSON.stringify(new URL(path, file).href)}`);
  await import(`data:text/javascript;base64,${Buffer.from(source + `\n// ${crypto.randomUUID()}`).toString("base64")}`);
  delete globalThis.__mountSettingForTest;
}
