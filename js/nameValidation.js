// Input validation only; never rewrite names or reject legacy data during loading.
export const hasName = value => typeof value === "string" && value.trim().length > 0;

export function duckNameIssues(build) {
  return (build?.ducks ?? []).flatMap((duck, index) => hasName(duck.name) ? [] : [{
    section: "name", duckId: duck.id, ownerName: `アヒル ${index + 1}`,
    code: "NAME_REQUIRED", path: "name", message: "アヒル名を入力してください（空白のみは使用できません）。",
  }]);
}
