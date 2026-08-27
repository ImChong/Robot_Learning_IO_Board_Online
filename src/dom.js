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

/** 单次公式渲染。KaTeX 还没加载时退化成等宽源码并返回 false，补渲染的事交给 queueMath。 */
function renderMath(target, tex) {
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

const pendingMath = new Set();

/**
 * 排一条公式：KaTeX 已就绪就当场渲染，否则先摆等宽源码占位，等 load 之后统一补渲染。
 * 队列放在这里而不是各视图里，是因为奖励面板与表格视图渲染的是同一批 form 字段，
 * 谁先渲染都可能赶在 KaTeX 之前，补渲染的账没必要记两份。
 */
export function queueMath(target, tex) {
  if (renderMath(target, tex)) return true;
  pendingMath.add([target, tex]);
  // 同一个函数引用重复 add 会被 DOM 去重，不会攒下一堆监听器；load 已经过了就
  // 不再补，页面上留着的等宽源码就是这种情况下的最终形态。
  if (document.readyState !== "complete") {
    window.addEventListener("load", flushMath, { once: true });
  }
  return false;
}

function flushMath() {
  // load 都过了 KaTeX 还没出现，就是这份 vendor 没加载成功：页面上留着的等宽源码
  // 就是最终形态，队列留着也补不上，清掉免得跨视图重渲染一直攒。
  if (!window.katex) {
    pendingMath.clear();
    return;
  }
  for (const entry of pendingMath) {
    const [target, tex] = entry;
    // 视图重渲染后旧节点已经离开文档，补渲染没有意义，直接销账。
    if (!target.isConnected || renderMath(target, tex)) pendingMath.delete(entry);
  }
}
