// Presentation only: use the compiler-selected branch and its resource breakdown.
export function formatCRequiredAP(resources, rules) {
  if (!resources.complete || resources.requiredAP == null || !resources.selectedBranchPath) return "必要AP：—";
  const rows = resources.effectBreakdown.filter(row => row.branchPath === resources.selectedBranchPath);
  if (!rows.length || rows.some(row => row.effectDelta == null || row.slotCost == null)) return "必要AP：—";
  const terms = rows.map(row => {
    const contribution = row.effectDelta + row.slotCost;
    return (contribution < 0 ? "－" : "＋") + Math.abs(contribution);
  }).join("");
  const floor = resources.rawAP < rules.minimumAP ? ` → 最低${rules.minimumAP}AP` : "";
  return `必要AP：最低AP${resources.baseAP}${terms}${floor}＝${resources.requiredAP}`;
}
