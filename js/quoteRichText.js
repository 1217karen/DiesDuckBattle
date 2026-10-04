// Dies quote markup only. Saved strings and skill-name ruby metadata are untouched.
const escapeHTML = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function parse(text) {
  const root = { children: [] }, stack = [root];
  const append = node => stack.at(-1).children.push(node);
  let position = 0;
  for (const match of text.matchAll(/<[^>]*>/g)) {
    if (match.index > position) append({ text: text.slice(position, match.index) });
    const token = match[0], tag = /^<(\/?)(b|i|u|rb|rt|small|big)>$/i.exec(token);
    if (!tag) append({ text: token });
    else if (tag[1]) {
      if (stack.length > 1 && stack.at(-1).tag === tag[2].toLowerCase()) {
        stack.pop().closed = true;
      } else append({ text: token });
    } else if (stack.length < 32) {
      const node = { tag: tag[2].toLowerCase(), opening: token, children: [], closed: false };
      append(node); stack.push(node);
    } else append({ text: token });
    position = match.index + token.length;
  }
  if (position < text.length) append({ text: text.slice(position) });
  return root;
}

function renderChildren(children, sized = false) {
  let html = "";
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (Object.hasOwn(node, "text")) { html += escapeHTML(node.text); continue; }
    if (!node.closed) { html += escapeHTML(node.opening) + renderChildren(node.children, sized); continue; }
    if (node.tag === "rb" && children[i + 1]?.tag === "rt" && children[i + 1].closed) {
      html += `<ruby>${renderChildren(node.children, sized)}<rt>${renderChildren(children[++i].children, sized)}</rt></ruby>`;
    } else if (["rb", "rt"].includes(node.tag)) {
      html += escapeHTML(node.opening) + renderChildren(node.children, sized) + escapeHTML(`</${node.tag}>`);
    } else if (["small", "big"].includes(node.tag)) {
      // Only the outermost size marker applies; nested sizes never multiply.
      const body = renderChildren(node.children, true);
      html += sized ? body : `<span class="quote-text-${node.tag}">${body}</span>`;
    } else html += `<${node.tag}>${renderChildren(node.children, sized)}</${node.tag}>`;
  }
  return html;
}

/** Returns safe renderer-owned HTML. No DOM parsing or user-supplied attributes. */
export function renderQuoteRichText(text) {
  return renderChildren(parse(typeof text === "string" ? text : "").children);
}
