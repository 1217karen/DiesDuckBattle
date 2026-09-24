export const IMAGE_LIMITS = {
  standing: { width: 500, height: 800, label: "立ち絵" },
  icon: { width: 250, height: 250, label: "アイコン" },
};

export function validateImageDimensions(kind, width, height) {
  const limit = IMAGE_LIMITS[kind];
  if (!(width > 0 && height > 0)) return { status: "invalid", message: "画像を読み込めないためサイズを確認できません。" };
  return width <= limit.width && height <= limit.height
    ? { status: "valid", message: `現在の画像：${width}×${height}px` }
    : { status: "invalid", message: `${limit.label}は${limit.width}×${limit.height}px以内の画像を指定してください。現在の画像：${width}×${height}px` };
}

/** Each preview request owns its callbacks. Late results cannot replace newer validation. */
export function createImageValidation(kind, onChange) {
  let version = 0;
  return url => {
    const request = ++version;
    const active = () => request === version;
    onChange({ status: url.trim() ? "loading" : "valid", message: url.trim() ? "画像サイズを確認中…" : "" });
    return {
      active,
      load(width, height) { if (active()) onChange(validateImageDimensions(kind, width, height)); },
      error() { if (active()) onChange({ status: "invalid", message: "画像を読み込めないためサイズを確認できません。URLを確認してください。" }); },
    };
  };
}

export function imageValidationSummary(states) {
  const values = [...states];
  const invalid = values.some(value => value.status === "invalid");
  const loading = values.some(value => value.status === "loading");
  return { canSave: !invalid && !loading, message: invalid ? "画像サイズ・URLを確認してください。Duckの別項目も確認できます。"
    : loading ? "画像サイズを確認中です。読み込み完了後に保存できます。" : "" };
}
