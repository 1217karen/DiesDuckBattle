import { requireLoginPage } from "./authPageGuard.js";
import { getSupabaseClient } from "./authRuntime.js";
import { finishPageLoad } from "./pageLoad.js";
import { createOnlineCharacterListService } from "./onlineCharacterListService.js";
import { filterCharacters } from "./characterListModel.js";
import { createCharacterCard } from "./characterListView.js";
export async function loadCharacterListPage({document=globalThis.document,requireLogin=requireLoginPage,
  getClient=getSupabaseClient,createService=createOnlineCharacterListService,finish=finishPageLoad}={}) {
  await requireLogin();
  const get=id=>document.getElementById(id),message=get("list-message");
  try {
    const result=await createService(await getClient()).list();
    if(!result.ok)throw new Error("load-failed");
    const render=()=>{
      const matches=filterCharacters(result.characters,{name:get("name-filter").value,attribute:get("attribute-filter").value,
        type:get("type-filter").value,sort:get("sort").value});
      get("character-list").replaceChildren(...matches.map(c=>createCharacterCard(document,c)));
      message.textContent=matches.length?"":"該当するキャラクターがいません。";
    };
    for(const id of ["name-filter","attribute-filter"])get(id).addEventListener("input",render);
    for(const id of ["type-filter","sort"])get(id).addEventListener("change",render);
    render();
  } catch {
    message.setAttribute("role","alert");message.textContent="キャラリストを読み込めませんでした。再度ページを開いてください。";
  } finally { finish(); }
}
if(typeof document!=="undefined")await loadCharacterListPage();
