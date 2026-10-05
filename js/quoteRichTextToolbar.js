const controls = [
  ["b", "B", "太字"], ["i", "I", "斜体"], ["u", "U", "下線"],
  ["rb", "rb", "ルビ"], ["small", "小", "小さい文字"], ["big", "大", "大きい文字"],
];

/** Pure selection edit. Positions use the input's UTF-16 selection offsets. */
export function editQuoteMarkup(text, start, end, tag) {
  if (!controls.some(([key]) => key === tag)) throw new RangeError("Unsupported quote decoration");
  start = Math.max(0, Math.min(text.length, start ?? text.length));
  end = Math.max(start, Math.min(text.length, end ?? start));
  const selected = text.slice(start, end);
  const opening = `<${tag}>`;
  const insertion = tag === "rb" ? `<rb>${selected}</rb><rt>ルビ</rt>` : `${opening}${selected}</${tag}>`;
  const selectionStart = tag === "rb" ? start + 4 + selected.length + 9 : start + opening.length;
  const selectionEnd = selectionStart + (tag === "rb" ? 2 : selected.length);
  return { text: text.slice(0, start) + insertion + text.slice(end), selectionStart, selectionEnd };
}

export function createQuoteToolbar(input, onChange, document = input.ownerDocument, { ariaLabel = "セリフの文字装飾" } = {}) {
  const toolbar = document.createElement("div"); toolbar.className = "quote-toolbar";
  toolbar.setAttribute("role", "group"); toolbar.setAttribute("aria-label", ariaLabel);
  for (const [tag, label, title] of controls) {
    const button = document.createElement("button"); button.type = "button";
    button.textContent = label; button.title = title; button.setAttribute("aria-label", title);
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => {
      const edit = editQuoteMarkup(input.value, input.selectionStart, input.selectionEnd, tag);
      input.value = edit.text; input.focus(); input.setSelectionRange(edit.selectionStart, edit.selectionEnd);
      onChange(input.value);
    });
    toolbar.append(button);
  }
  return toolbar;
}
