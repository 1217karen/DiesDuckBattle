import { clonePlayerBuild } from "./playerBuildModel.js";
import { createASkillCatalog } from "./aSkillCatalog.js";
import { createBSkillCatalog } from "./bSkillCatalog.js";
import { createCSkillCatalog } from "./cSkillCatalog.js";
import { migrateSelection } from "./selectionNormalization.js";
/** Explicit, lossless v1 -> v2 upgrade. Failure returns no replacement build. */
export function migratePlayerBuild(value) {
  if (Number.isInteger(value?.schemaVersion) && value.schemaVersion > 0 && ![1,2].includes(value.schemaVersion))
    return {ok:false,status:"unsupported-version",build:null};
  let copy;
  try { copy=clonePlayerBuild(value); }
  catch { return {ok:false,status:"corrupt",build:null}; }
  if(copy.schemaVersion===2) return {ok:true,status:"current",build:copy};
  try {
    copy.battler.bSelection=migrateSelection("B",copy.battler.bSelection,createBSkillCatalog());
    const a=createASkillCatalog(),c=createCSkillCatalog();
    for(const duck of copy.ducks) {
      duck.aSelection=migrateSelection("A",duck.aSelection,a);
      duck.cSelection=migrateSelection("C",duck.cSelection,c);
    }
    copy.schemaVersion=2;
    return {ok:true,status:"migrated",build:clonePlayerBuild(copy),fromVersion:1};
  } catch { return {ok:false,status:"migration-required",build:null}; }
}
