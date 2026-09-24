import { createEmptyPlayerBuild, clonePlayerBuild } from "./playerBuildModel.js";
import { migratePlayerBuild } from "./playerBuildMigration.js";
export const PLAYER_BUILD_STORAGE_KEY = "diesDuckBattle:player-build:v2";
export const LEGACY_PLAYER_BUILD_STORAGE_KEY = "diesDuckBattle:player-build:v1";
/** Reads are non-destructive. v1 is kept as a backup even after an explicit v2 save. */
export function createPlayerBuildStorage(storage) {
  const target=()=>storage??globalThis.localStorage;
  function load() {
    let raw,sourceKey=PLAYER_BUILD_STORAGE_KEY;
    try {
      raw=target().getItem(sourceKey);
      if(raw===null) {sourceKey=LEGACY_PLAYER_BUILD_STORAGE_KEY;raw=target().getItem(sourceKey);}
    } catch {return {ok:false,status:"storage-error",build:null};}
    if(raw===null) return {ok:true,status:"empty",build:createEmptyPlayerBuild()};
    let value;
    try {value=JSON.parse(raw);} catch {return {ok:false,status:"corrupt",build:null};}
    if(Number.isInteger(value?.schemaVersion)&&value.schemaVersion>0&&![1,2].includes(value.schemaVersion))
      return {ok:false,status:"unsupported-version",schemaVersion:value.schemaVersion,build:null};
    const migrated=migratePlayerBuild(value);
    return migrated.ok?{ok:true,status:"loaded",build:migrated.build,sourceKey,migratedFrom:migrated.fromVersion??null}
      :{...migrated,sourceKey};
  }
  function save(build) {
    const migrated=migratePlayerBuild(build);
    if(!migrated.ok) return {ok:false,status:"invalid-build"};
    const current=load();
    if(!current.ok) return {ok:false,status:current.status};
    try {target().setItem(PLAYER_BUILD_STORAGE_KEY,JSON.stringify(clonePlayerBuild(migrated.build)));}
    catch {return {ok:false,status:"storage-error"};}
    return {ok:true,status:"saved"};
  }
  return {load,save};
}
