import { D_SKILL_OPTIONS } from "./dSkillCatalog.js";
import { compileDSkill } from "./dSkillCompiler.js";
import { runDSkillTestBattle } from "./dSkillTestHarness.js";

const $ = id => document.getElementById(id);
const json = value => JSON.stringify(value, null, 2);
const selection = () => ({ optionId: $("option").value });
for (const option of D_SKILL_OPTIONS) {
  const node = document.createElement("option");
  node.value = option.id; node.textContent = option.label; $("option").append(node);
}
function update() {
  const dto = selection(), compilation = compileDSkill(dto);
  $("selection").textContent = json(dto);
  $("compilation").textContent = json(compilation);
  $("errors").textContent = json(compilation.errors);
  $("skill").textContent = json(compilation.skill);
  $("compile-status").textContent = compilation.ok ? "compile成功" : "compile失敗";
  $("battle").disabled = !compilation.ok;
  $("battle-log").textContent = "";
  $("battle-message").textContent = "設定を確認して「戦闘する」を押してください。";
}
$("option").addEventListener("change", update);
for (const id of ["p1-dice", "p2-dice"]) $(id).addEventListener("input", update);
$("battle").addEventListener("click", () => {
  try {
    for (const id of ["p1-dice", "p2-dice"]) if (!$(id).reportValidity()) return;
    const { compilation, battle } = runDSkillTestBattle(selection(), {
      p1Dice: $("p1-dice").valueAsNumber, p2Dice: $("p2-dice").valueAsNumber,
    });
    if (!compilation.ok) throw new Error(json(compilation.errors));
    const pools = {}, logs = [];
    for (const event of battle.events) {
      if (event.type === "battleStart") {
        for (const side of ["P1", "P2"]) pools[side] = [...event.meta[side].dicePool];
      }
      if (event.type === "diceAdded") pools[event.target].push(...event.values);
      if (["battleStart", "skillTriggered", "diceAdded", "roll", "battleEnd"].includes(event.type))
        logs.push({ ...event, observedDicePools: { P1: [...pools.P1], P2: [...pools.P2] } });
    }
    $("battle-message").textContent = `戦闘完了: ${battle.result}（pool表示はイベントから再構成）`;
    $("battle-log").textContent = json(logs);
  } catch (error) { $("battle-message").textContent = error.message; }
});
update();
