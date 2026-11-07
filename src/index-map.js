/**
 * 维度地图：把一个向量的每个 index 落到「它是什么」。
 *
 * 数据里没有逐 index 的表，只有两样东西：
 *   1. 拼接节点的入边——谁接在谁后面，入边的书写顺序就是拼接顺序（校验脚本
 *      会拿 dimExpr 的分项核对这一点，所以它是被强制的约定，不是巧合）；
 *   2. 每个节点的 dimLayout——人写的分量顺序，比如「帧 t−9 → t × (ω_x, ω_y, ω_z)」。
 *
 * 这里把这两样翻成一棵树，每一层都能回答「第 i 个数落在哪一段、段内第几个」。
 * 原则是宁缺毋滥：dimLayout 的写法解析不出来、或者解析出来的各段加起来对不上
 * 维数，就退回成「这一段第 k 个」并把原文摆出来，绝不编一个分量名。
 *
 * 纯数据模块，不碰 DOM：页面和 scripts/validate.mjs 共用同一份，校验脚本会对
 * 每个带维度的节点跑一遍，确认推出来的树与维数自洽。
 *
 * 树的四种结点（size 都是这一层覆盖的 index 个数）：
 *   seq    { parts: [{ label, size, start, text, nodeId?, layout }] }   顺序拼接
 *   grid   { axis: { name, count, items, text }, inner }                 axis.count 份 inner 首尾相接
 *   items  { name, items: (string|null)[], text }                        逐个 index 一个名字（null = 数据没写名字）
 *   opaque { text }                                                      只知道大小
 */

const OPEN = "([（【";
const CLOSE = ")]）】";

/** 在括号深度为 0 的位置切分。分隔符可以是多字符。 */
function splitTop(text, sep) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (OPEN.includes(ch)) depth += 1;
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && text.startsWith(sep, i)) {
      out.push(text.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim());
}

/** 顶层第一个出现的分隔符位置（任选其一），没有则 -1。 */
function indexTop(text, seps) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (OPEN.includes(ch)) depth += 1;
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && seps.some((s) => text.startsWith(s, i))) return i;
  }
  return -1;
}

/** 把一句 layout 切成「主干」与「补充说明」：主干到顶层第一个逗号 / 破折号 / 句号为止。 */
function splitMain(text) {
  const at = indexTop(text, ["——", "，", "；", "。"]);
  if (at < 0) return [text.trim(), ""];
  return [
    text.slice(0, at).trim(),
    text
      .slice(at)
      .replace(/^[——，；。\s]+/, "")
      .trim(),
  ];
}

/** 整段被一对括号包住时返回括号里的内容。 */
function unwrap(text, open, close) {
  const t = text.trim();
  if (!t.startsWith(open) || !t.endsWith(close)) return null;
  // 确认首尾那对括号是配对的，而不是「(a) × (b)」这种。
  let depth = 0;
  for (let i = 0; i < t.length; i += 1) {
    if (OPEN.includes(t[i])) depth += 1;
    else if (CLOSE.includes(t[i])) depth -= 1;
    if (depth === 0 && i < t.length - 1) return null;
  }
  return t.slice(1, -1);
}

/** 顶层的全角括号说明，如「关节 1…29 按 …序（左髋p · 右髋p · …）」里的那一段。 */
function fullWidthParen(text) {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (OPEN.includes(ch)) {
      if (depth === 0 && ch === "（") start = i;
      depth += 1;
    } else if (CLOSE.includes(ch)) {
      depth -= 1;
      if (depth === 0 && ch === "）" && start >= 0) return text.slice(start + 1, i);
    }
  }
  return null;
}

/** 去掉所有括号段，留下骨架文字。 */
function stripParens(text) {
  let out = "";
  let depth = 0;
  for (const ch of text) {
    if (OPEN.includes(ch)) depth += 1;
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** 「a, b, c」或「a · b · c」→ 名字列表。 */
function listItems(inner) {
  const sep = splitTop(inner, " · ").length > 1 ? " · " : ",";
  return splitTop(inner, sep).filter(Boolean);
}

/**
 * 「(左髋p · 右髋p · 腰y · …)」这种以省略号结尾的是前缀列表：只写了前几个，
 * 后面的名字数据里没有。返回 { names, partial }。
 */
function nameList(inner) {
  const items = listItems(inner);
  const last = items[items.length - 1];
  if (last === "…" || last === "...") return { names: items.slice(0, -1), partial: true };
  return { names: items, partial: false };
}

/** 一个 0 维的 layout 是没有意义的；这里统一把 size 不对的结果判成失败。 */
const fits = (layout, size) => (layout && layout.size === size ? layout : null);

/** 名字像一句话而不像一个量的名字时，不拿它当轴名。 */
const shortName = (name) => name && name.length <= 14;

/**
 * 帧轴：「帧 +1…+10」「帧 t−9 → t」「帧 t−9…t」「帧 +1/+2/+3」。
 * 帧号都是数据里写出来的端点展开的，中间不插任何猜测。
 */
function frameAxis(text) {
  const t = stripParens(text);
  let m = t.match(/^帧\s*\+(\d+)\s*…\s*\+(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (b >= a)
      return axis(
        "帧",
        range(a, b).map((k) => `+${k}`),
        text,
      );
  }
  m = t.match(/^帧\s*t\s*[−-]\s*(\d+)\s*(?:→|…)\s*t$/);
  if (m) {
    const n = Number(m[1]);
    return axis(
      "帧",
      range(0, n).map((k) => (n - k === 0 ? "t" : `t−${n - k}`)),
      text,
    );
  }
  m = t.match(/^帧\s*(\+\d+(?:\s*\/\s*\+\d+)+)$/);
  if (m)
    return axis(
      "帧",
      m[1].split("/").map((s) => s.trim()),
      text,
    );
  m = t.match(/^(\d+)\s*帧$/);
  if (m) return { name: "帧", count: Number(m[1]), items: null, text };
  return null;
}

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

function axis(name, items, text) {
  return { name, count: items.length, items, text };
}

/**
 * 一个乘数因子 → 轴。认得的写法：
 *   (x, y, z) / (左腕 · 右腕 · 头)       逐个写出名字
 *   14 连杆按 body_names 序（a · b · …）  个数 + 括号里的名字（个数对得上才用）
 *   关节 1…29 按 …序（左髋p · … · …）     区间给个数，省略号前的名字只覆盖前几个
 *   tan-norm 6 / 30 关节 / SMPL 24 关节   只有个数
 *   帧 …                                  见 frameAxis
 * 个数读不出来时 count 为 null，由调用方用总维数反推（只允许一个未知）。
 */
function parseAxis(text) {
  const t = text.trim();
  const frames = frameAxis(t);
  if (frames) return frames;

  const tuple = unwrap(t, "(", ")");
  if (tuple != null) {
    const items = listItems(tuple);
    return axis(items.length === 1 ? items[0] : "分量", items, t);
  }

  const bare = stripParens(t);
  if (!bare) return null;
  const paren = fullWidthParen(t);
  let count = null;
  let name = bare;

  // 「64 维 FSQ 码字」「与 z 同一个 64 维单位球面」：只说了是多少维，没有逐维的名字。
  const dims = bare.match(/(\d+)\s*维/);
  if (dims) return { name: "维", count: Number(dims[1]), items: null, text: t };

  const span = bare.match(/(\S*?)\s*1\s*…\s*(\d+)/);
  if (span) {
    count = Number(span[2]);
    name = span[1] || bare.replace(span[0], "");
  } else {
    const nums = bare.match(/\d+/g);
    if (nums && nums.length === 1) {
      count = Number(nums[0]);
      name = bare.replace(nums[0], "");
    }
  }
  name = name
    .replace(/^与.*?同序的?/, "")
    .replace(/(?:按|，).*$/, "")
    .replace(/^\s*个\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^维/.test(name) || !name) name = "维";
  if (!shortName(name)) return null;

  let items = null;
  if (paren && count != null) {
    const { names, partial } = nameList(paren);
    const looksLikeNames = names.length > 1 && names.every((s) => s.length <= 12 && !/[：:]/.test(s));
    if (looksLikeNames && (names.length === count || (partial && names.length < count))) {
      items = names.concat(Array(count - names.length).fill(null));
    }
  }
  return { name, count, items, text: t };
}

/** 若干轴（外 → 内）叠成 grid 树；最内层是 items 或给定的 inner。 */
function buildGrid(axes, size, inner = null) {
  const known = axes.reduce((p, a) => p * (a.count ?? 1), 1) * (inner ? inner.size : 1);
  const unknown = axes.filter((a) => a.count == null);
  if (unknown.length > 1) return null;
  if (unknown.length === 1) {
    if (size % known !== 0) return null;
    unknown[0].count = size / known;
  } else if (known !== size) return null;

  let node = inner;
  for (let i = axes.length - 1; i >= 0; i -= 1) {
    const a = axes[i];
    if (!node) {
      node = {
        type: "items",
        size: a.count,
        name: a.name,
        items: a.items ?? Array(a.count).fill(null),
        text: a.text,
      };
    } else if (a.count > 1) {
      node = { type: "grid", size: a.count * node.size, axis: a, inner: node };
    }
    // 只有一份的外层轴（ADD 的「当前帧 × […]」）不另起一层：条形图上一整条「当前帧 1」毫无信息。
  }
  return node;
}

/**
 * 「name N · name N · …」或「[a | b]」这种并列清单 → seq。
 * 每一项的大小按优先级取：「… = N」、「name(N)」、「N 维 name」、末尾的数字、开头的数字、
 * 自身能解析出的维数。各项加起来必须正好等于 size。
 */
function parseSeqList(listText, size, sep) {
  const items = splitTop(listText, sep).filter(Boolean);
  if (items.length < 2) return null;
  const parts = [];
  for (const raw of items) {
    const part = parsePart(raw);
    if (!part) return null;
    parts.push(part);
  }
  if (parts.reduce((s, p) => s + p.size, 0) !== size) return null;
  return seq(parts);
}

function parsePart(raw) {
  const t = raw.trim();
  const bracket = unwrap(t, "[", "]");
  if (bracket != null) {
    // 嵌套的 [a | b]：大小由内部各项相加。
    const sub = splitTop(bracket, " | ").map(parsePart);
    if (sub.some((p) => !p)) return null;
    const size = sub.reduce((s, p) => s + p.size, 0);
    return { label: stripParens(t).slice(0, 24) || "分组", size, text: t, layout: seq(sub) };
  }

  let m = t.match(/^(.*?)\s*=\s*(\d+)$/);
  if (m) {
    const size = Number(m[2]);
    const body = m[1].trim();
    return { label: body, size, text: t, layout: parseLayout(body, size) };
  }
  m = t.match(/^([^\s(（]+)\s*\((\d+)\)$/);
  if (m) {
    const size = Number(m[2]);
    return { label: m[1], size, text: t, layout: opaque(size, t) };
  }
  m = t.match(/^(\d+)\s*维\s*(.+)$/);
  if (m) {
    const size = Number(m[1]);
    const label = stripParens(m[2]) || m[2];
    const inner = fullWidthParen(m[2]);
    const nested = inner ? parseSeqList(inner, size, " · ") : null;
    return { label, size, text: t, layout: nested ?? opaque(size, t) };
  }
  m = t.match(/^(.*\S)\s+(\d+)$/);
  if (m) {
    const size = Number(m[2]);
    const head = m[1].trim();
    // 「根位置 (x, y, z) 3」：名字后面跟着逐个分量。
    const tuple = head.match(/^(.*?)\s*(\([^()]*\))$/);
    const label = tuple ? tuple[1] || head : head;
    const layout = tuple ? parseLayout(tuple[2], size) : parseLayout(head, size, { needCount: true });
    return { label, size, text: t, layout };
  }
  m = t.match(/^(\d+)\s+(.+)$/);
  if (m) {
    const size = Number(m[1]);
    return { label: m[2].trim(), size, text: t, layout: opaque(size, t) };
  }
  return null;
}

function seq(parts) {
  let start = 0;
  const placed = parts.map((p) => {
    const part = { ...p, start, layout: p.layout ?? opaque(p.size, p.text) };
    start += p.size;
    return part;
  });
  return { type: "seq", size: start, parts: placed };
}

function opaque(size, text) {
  return { type: "opaque", size, text };
}

/**
 * 解析一句 dimLayout。返回 size 正好等于给定维数的树，或 null。
 * opts.needCount：单个因子读不出个数时宁可放弃，不拿总维数硬凑（用于清单里的子项，
 * 免得「线速度 3」被解析成一条名叫「线速度」的 3 格轴——那和 opaque 没区别，还多一层假结构）。
 */
export function parseLayout(text, size, opts = {}) {
  if (!text || !size) return null;
  let t = text.trim();
  // 「与动作同序：…」这类前缀只是说明，不是布局本身。
  t = t.replace(/^与[^：:，]{1,12}同序[：:]\s*/, "");

  // Isaac Lab 的 Ant：「先 4 个髋关节（*_leg），再 4 个踝关节（*_foot）」。
  const firstThen = t.match(/先\s*(\d+)\s*个([^，。；]+?)，\s*再\s*(\d+)\s*个([^，。；]+?)(?:[。；，]|$)/);
  if (firstThen) {
    const a = Number(firstThen[1]);
    const b = Number(firstThen[3]);
    if (a + b === size) {
      return seq([
        { label: firstThen[2].trim(), size: a, text: `${a} 个${firstThen[2].trim()}`, layout: null },
        { label: firstThen[4].trim(), size: b, text: `${b} 个${firstThen[4].trim()}`, layout: null },
      ]);
    }
  }

  // 冒号后面是清单：「拼接顺序：a 3 · b 6 · …」或「14 伺服关节按 MJCF 深度优先：左髋yaw · …」。
  const head = t.slice(0, Math.max(0, indexTop(t, ["——", "；", "。"])) || t.length);
  const colon = indexTop(head, ["：", ": "]);
  if (colon >= 0) {
    const list = head.slice(colon + 1).trim();
    const asSeq = parseSeqList(list, size, " · ");
    if (asSeq) return asSeq;
    const { names, partial } = nameList(list);
    if (!partial && names.length === size && names.every((s) => s.length <= 16)) {
      return {
        type: "items",
        size,
        name: stripParens(head.slice(0, colon)) || "分量",
        items: names,
        text: t,
      };
    }
  }

  const [main, rest] = splitMain(t);

  // 乘积：「帧 × 关节」「14 连杆 × (x, y, z)」「帧 × [a 3 · b 6]」。
  const factors = splitTop(main, "×");
  if (factors.length > 1) {
    // 「帧 × […]（disc_dof_vel_obs: False，…）」：方括号后面跟的全角括号是说明，不是布局。
    const last = factors[factors.length - 1].replace(/（[^（）]*）$/, "").trim();
    const bracket = unwrap(last, "[", "]");
    let inner = null;
    if (bracket != null) {
      const outer = factors.slice(0, -1).map(parseAxis);
      if (outer.some((a) => !a)) return null;
      const known = outer.reduce((p, a) => p * (a.count ?? 1), 1);
      const unknown = outer.filter((a) => a.count == null).length;
      // 括号里的清单自己有确定的大小，外层未知的那一个轴由它反推。
      for (const sep of [" · ", " | "]) {
        const items = splitTop(bracket, sep);
        if (items.length < 2) continue;
        const parts = items.map(parsePart);
        if (parts.some((p) => !p)) continue;
        const sum = parts.reduce((s, p) => s + p.size, 0);
        if (unknown === 0 ? known * sum === size : size % sum === 0) {
          inner = seq(parts);
          break;
        }
      }
      if (!inner) return null;
      return fits(buildGrid(outer, size, inner), size);
    }
    const axes = factors.map(parseAxis);
    if (axes.some((a) => !a)) return null;
    return fits(buildGrid(axes, size), size);
  }

  // [a | b]：后面的补充说明（「两段都按 关节 1…29 …」）对每一段都成立。
  const bracket = unwrap(main, "[", "]");
  if (bracket != null) {
    const s = parseSeqList(bracket, size, " | ");
    if (!s) return null;
    const shared = rest.replace(/^(?:两段|各段|每段)?都按\s*/, "");
    for (const part of s.parts) {
      if (part.layout.type === "opaque" && shared) {
        const sub = parseLayout(shared, part.size, { needCount: true });
        if (sub) part.layout = sub;
      }
    }
    return s;
  }

  // (x, y, z)
  const tuple = unwrap(main, "(", ")");
  if (tuple != null) {
    const items = listItems(tuple);
    if (items.length === size) return { type: "items", size, name: "分量", items, text: t };
    return null;
  }

  if (/^标量/.test(main) && size === 1) {
    return { type: "items", size: 1, name: "标量", items: [t.replace(/^标量[：:]\s*/, "")], text: t };
  }

  // 只有一根轴：「自由度 1…29（…）」「关节 1…29 按 …序（左髋p · …）」。
  const a = parseAxis(main);
  if (a && (a.count === size || (a.count == null && !opts.needCount))) {
    return fits(buildGrid([a], size), size);
  }
  return null;
}

/**
 * 一个节点的维度地图。
 *
 * 优先用入边：≥ 2 个带维度的上游、维数加起来正好等于自己，就是一个拼接节点，
 * 每一段直接挂上那个上游模块（它自己的 dimLayout 再往下展开）。否则解析自己的
 * dimLayout；再不行，若 dimLayout 明说与另一个模块「同布局」，借那个模块的。
 *
 * 返回 { size, layout, basis }，basis 说明这棵树是从哪推出来的，页面照实写给读者：
 *   "edges"   按入边拼接（顺序已由校验脚本与 dimExpr 核对）
 *   "layout"  按 dimLayout 原文解析
 *   "borrow"  按 dimLayout 原文指名的另一个模块
 *   "none"    原文解析不出逐个 index 的含义，只有总维数
 */
export function buildIndexMap(node, graph, _seen = new Set()) {
  if (!node || node.dim == null || node.dim <= 0) return null;
  const size = node.dim;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen = new Set(_seen).add(node.id);

  const sources = concatSources(node, graph, byId);
  if (sources) {
    const parts = sources.map((src) => {
      const child = seen.has(src.id) ? null : buildIndexMap(src, graph, seen);
      return {
        label: src.label,
        size: src.dim,
        text: src.dimLayout ?? "",
        nodeId: src.id,
        layout: child?.layout ?? opaque(src.dim, src.dimLayout ?? ""),
      };
    });
    return { size, layout: seq(parts), basis: "edges" };
  }

  // 「缓冲里每条都是一份 d.window 同布局的 1140 维窗口」：原文点名了另一个模块，用它的。
  if (node.dimLayout && /同布局/.test(node.dimLayout)) {
    const ref = graph.nodes.find(
      (n) => n.id !== node.id && n.dim === size && node.dimLayout.includes(n.id) && !seen.has(n.id),
    );
    const borrowed = ref ? buildIndexMap(ref, graph, seen) : null;
    if (borrowed) return { size, layout: borrowed.layout, basis: "borrow", borrowedFrom: ref.id };
  }

  const own = parseLayout(node.dimLayout ?? "", size);
  if (own) {
    linkPartsByEdge(own, node, graph, byId, seen);
    return { size, layout: own, basis: "layout" };
  }

  return { size, layout: opaque(size, node.dimLayout ?? ""), basis: "none" };
}

/**
 * 「拼接顺序：command 58 · … · 连杆位置 42 · 连杆姿态 84」这种清单，只有一部分段
 * 在图上有入边（特权 critic 观测：连杆真值从仿真直连，其余是策略观测的无噪版，
 * 图上没画那几条线）。有入边、且这个维数在入边里独一份的段，挂上那个上游模块，
 * 好让读者继续往下看到逐个分量；其余的段只有名字与维数，不按名字去全图里猜。
 */
function linkPartsByEdge(layout, node, graph, byId, seen) {
  if (layout.type !== "seq") return;
  const sources = graph.edges
    .filter((e) => e.to === node.id)
    .map((e) => byId.get(e.from))
    .filter((n) => n && n.dim != null);
  for (const part of layout.parts) {
    if (part.nodeId) continue;
    const same = sources.filter((n) => n.dim === part.size);
    if (same.length !== 1 || seen.has(same[0].id)) continue;
    const child = buildIndexMap(same[0], graph, seen);
    part.nodeId = same[0].id;
    part.linkedBy = "edge";
    if (child && part.layout.type === "opaque") part.layout = child.layout;
  }
}

/**
 * 拼接节点的上游，按拼接顺序。≥ 2 个带维度的入边、维数之和等于自身才算；
 * 「两路相减」（ADD 的 d.diff）、「从窗口里编码」（ASE 的 d.enc）加起来对不上，自然被排除。
 */
export function concatSources(node, graph, byId = new Map(graph.nodes.map((n) => [n.id, n]))) {
  if (node.dim == null) return null;
  const sources = graph.edges
    .filter((e) => e.to === node.id)
    .map((e) => byId.get(e.from))
    .filter((n) => n && n.dim != null);
  if (sources.length < 2) return null;
  if (sources.reduce((s, n) => s + n.dim, 0) !== node.dim) return null;
  return sources;
}

/**
 * 第 index 个数从外到内的路径：[{ label, start, size, pos, nodeId?, text, kind }]。
 * 每一层说明「落在哪一段（或哪一帧、哪个分量）、段内第几个」。
 */
export function locate(layout, index) {
  const path = [];
  let node = layout;
  let offset = index;
  let base = 0;
  while (node) {
    if (node.type === "seq") {
      const part = node.parts.find((p) => offset >= p.start && offset < p.start + p.size);
      if (!part) break;
      path.push({
        kind: "part",
        label: part.label,
        start: base + part.start,
        size: part.size,
        pos: offset - part.start,
        nodeId: part.nodeId,
        text: part.text,
      });
      base += part.start;
      offset -= part.start;
      node = part.layout;
    } else if (node.type === "grid") {
      const k = Math.floor(offset / node.inner.size);
      const name = node.axis.items?.[k];
      path.push({
        kind: "axis",
        label: name != null ? axisItemLabel(node.axis.name, name) : `${node.axis.name} 第 ${k + 1} 个`,
        named: name != null,
        start: base + k * node.inner.size,
        size: node.inner.size,
        pos: k,
        of: node.axis.count,
        text: node.axis.text,
      });
      base += k * node.inner.size;
      offset -= k * node.inner.size;
      node = node.inner;
    } else if (node.type === "items") {
      const name = node.items[offset];
      path.push({
        kind: "item",
        label: name != null ? name : `${node.name} 第 ${offset + 1} 个`,
        named: name != null,
        start: base + offset,
        size: 1,
        pos: offset,
        of: node.size,
        text: node.text,
      });
      break;
    } else {
      path.push({
        kind: "opaque",
        label: `第 ${offset + 1} 个（共 ${node.size}）`,
        named: false,
        start: base + offset,
        size: 1,
        pos: offset,
        of: node.size,
        text: node.text,
      });
      break;
    }
  }
  return path;
}

/** 帧号单独读不懂（「+3」），带上轴名；分量名本身就是名字（「ω_x」「左髋p」）。 */
function axisItemLabel(axisName, item) {
  return axisName === "帧" ? `帧 ${item}` : item;
}

/**
 * 一层树的「分组」：条形图上并排画的那几段。
 * seq 的每一段；grid 的每一份（帧、关节、连杆）；items 的每一个分量；opaque 只有一段。
 */
export function groupsOf(layout, base = 0) {
  if (layout.type === "seq") {
    return layout.parts.map((p) => ({
      label: p.label,
      start: base + p.start,
      size: p.size,
      nodeId: p.nodeId,
      linkedBy: p.linkedBy,
      text: p.text,
      layout: p.layout,
    }));
  }
  if (layout.type === "grid") {
    const { axis: a, inner } = layout;
    return Array.from({ length: a.count }, (_, k) => {
      const name = a.items?.[k];
      return {
        label: name != null ? axisItemLabel(a.name, name) : `${a.name} ${k + 1}`,
        // 条形图段内放不下「帧 t−9」时用的短名：帧号本身。
        short: name != null && a.name === "帧" ? name : undefined,
        named: name != null,
        start: base + k * inner.size,
        size: inner.size,
        text: a.text,
        layout: inner,
      };
    });
  }
  if (layout.type === "items") {
    // 一个名字都没写的（「自由度 1…29」「64 维 FSQ 码字」）拆成 29 段无名小格毫无信息，
    // 条形图上就是一整段；逐个 index 仍可在下面的方格里点。
    if (layout.size > 1 && layout.items.every((n) => n == null)) {
      return [
        {
          label: `${layout.name} 1…${layout.size}`,
          start: base,
          size: layout.size,
          text: layout.text,
          layout,
          whole: true,
        },
      ];
    }
    return layout.items.map((name, k) => ({
      label: name ?? `${layout.name} ${k + 1}`,
      named: name != null,
      start: base + k,
      size: 1,
      text: layout.text,
      layout: null,
    }));
  }
  return [{ label: "整段", start: base, size: layout.size, text: layout.text, layout: null }];
}

/** 能否再往下分一层（opaque / 单个分量就到底了）。 */
export function hasInner(layout) {
  return Boolean(layout) && layout.type !== "opaque" && !(layout.type === "items" && layout.size === 1);
}

/** 这棵树里，名字确实写在数据里的 index 有多少个（供校验脚本统计覆盖率）。 */
export function namedCount(layout) {
  let named = 0;
  for (let i = 0; i < layout.size; i += 1) {
    const last = locate(layout, i).at(-1);
    if (last?.named) named += 1;
  }
  return named;
}
