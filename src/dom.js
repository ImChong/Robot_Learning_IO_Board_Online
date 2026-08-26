/** 极简 DOM 构造工具。所有文本走 textContent，不拼 HTML 字符串。 */

export function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(opts)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "style") Object.assign(node.style, value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function svgEl(tag, opts = {}, children = []) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(opts)) {
    if (value == null || value === false) continue;
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** 公式渲染。KaTeX 还没加载时退化成等宽源码，load 之后由调用方重渲染。 */
export function renderMath(target, tex) {
  if (window.katex) {
    try {
      window.katex.render(tex, target, { throwOnError: false, displayMode: false });
      return true;
    } catch {
      /* 落到下面的兜底 */
    }
  }
  clear(target).append(el("code", { text: tex }));
  return false;
}
