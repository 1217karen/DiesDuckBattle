import { createEmptyPlayerBuild, createEmptyDuck } from "../../../js/playerBuildModel.js";
import { createEmptyPlayerPresentation, createEmptyDuckPresentation } from "../../../js/playerPresentationModel.js";
import { encodeOnlinePlayer } from "../../../js/onlinePlayerDto.js";

/** Use the same current DTO/defaults as normal saves, including presentation. */
export function createRegistrationPlayer(name, uuid) {
  const build = createEmptyPlayerBuild(), duck = createEmptyDuck({ idFactory: uuid });
  duck.name = `${name}のマイアヒル`;
  build.ducks.push(duck);
  const presentation = createEmptyPlayerPresentation();
  presentation.ducks[duck.id] = createEmptyDuckPresentation();
  return encodeOnlinePlayer({ build, presentation, battlerName: name,
    publicSettings: { schemaVersion: 1, publicDuckId: duck.id } });
}
