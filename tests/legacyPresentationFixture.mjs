import { createEmptyDuckQuotes } from '../js/playerPresentationModel.js';
export function legacyQuoteOwnership(p) {
 const quotes = Object.values(p.ducks)[0]?.quotes ?? createEmptyDuckQuotes();
 p.battler.quotes.skill.A ??= structuredClone(quotes.skill.A);
 p.battler.quotes.skill.C ??= structuredClone(quotes.skill.C);
 for(const duck of Object.values(p.ducks)) delete duck.quotes;
 return p;
}
export function legacyDtoQuoteOwnership(dto) {
 const p={battler:dto.battler.presentation,ducks:dto.battler.presentation.detachedDuckPresentation};
 legacyQuoteOwnership(p);
 for(const duck of dto.ducks) if(duck.presentation.icon) delete duck.presentation.icon.quotes;
}
