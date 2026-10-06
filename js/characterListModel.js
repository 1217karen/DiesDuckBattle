// Canonical positive decimal strings compare numerically without Number rounding.
export const compareEno = (a,b) => a.length-b.length || (a<b?-1:a>b?1:0);
export function filterCharacters(characters,{name="",attribute="",type="",sort="eno-asc"}={}) {
  const query=name.trim().toLowerCase(),attr=attribute.trim();
  return characters.filter(c=>(!query || c.battlerName.toLowerCase().includes(query) || c.duck?.name.toLowerCase().includes(query))
    && (!attr || c.duck?.attributes.includes(attr)) && (!type || c.duck?.type===type)).sort((a,b)=>{
      if(sort==="eno-desc")return compareEno(b.eno,a.eno);
      if(sort==="best"){
        if(a.bestStreak===null && b.bestStreak!==null)return 1;
        if(a.bestStreak!==null && b.bestStreak===null)return -1;
        if(a.bestStreak!==b.bestStreak)return b.bestStreak-a.bestStreak;
      }
      return compareEno(a.eno,b.eno);
    });
}
