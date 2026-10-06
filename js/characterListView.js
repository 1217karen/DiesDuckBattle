import { FIXED_IMAGES, setImageWithFallback } from "./fixedImages.js";
import { CHARACTER_TYPES } from "./onlineCharacterListService.js";
export function createCharacterCard(document, character) {
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  const card=el("a",undefined,"character-card");card.href=`profile.html?eno=${character.eno}`;
  card.style.borderColor=character.accent;
  card.append(el("span",`ENo.${character.eno}`,"character-eno"),el("h2",character.battlerName,"character-name"));
  const body=el("div",undefined,"character-card-body"),battler=el("img",undefined,"character-battler-icon");
  battler.alt="";battler.width=120;battler.height=120;setImageWithFallback(battler,character.battlerIconUrl,FIXED_IMAGES.battlerIcon);
  const info=el("div",undefined,"character-duck"),duck=el("img",undefined,"character-duck-icon");
  duck.alt="";duck.width=60;duck.height=60;setImageWithFallback(duck,character.duck?.iconUrl,FIXED_IMAGES.duckIcon);
  const identity=el("div",undefined,"character-duck-identity");identity.append(duck,el("span",character.duck?.name??"―","character-duck-name"));
  info.append(identity,el("p",character.duck?.type?`${CHARACTER_TYPES[character.duck.type]}タイプ`:"―"),
    el("p",`属性：${character.duck?.attributes.filter(Boolean).join("・")||"―"}`),
    el("p",`最大連勝：${character.bestStreak??"―"}`));
  body.append(battler,info);card.append(body);return card;
}
