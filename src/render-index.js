/**
 * 维度地图面板：一条条形图（一段 = 一组 index）+ 一片方格（一格 = 一个 index）+ 一张说明卡。
 *
 * 读法是「先粗后细」：顶上那条按拼接顺序分段；点一段，下面再长出一条它内部的分段
 * （帧 → 关节 → 分量），一直点到最细；任意一格直接点，卡片给出它从外到内的完整路径。
 * 树本身由 index-map.js 从数据推出来，这里只负责画与交互。
 *
 * 方格整块是 aria-hidden 的——几百个可聚焦的格子只会把 Tab 键淹掉。键盘走条形图
 * （每段是按钮）与卡片上的「上一个 / 下一个」，同样能走到每一个 index。
 */

import { el, clear } from "./dom.js";
import { groupsOf, hasInner, locate } from "./index-map.js";

/** 一次画全的方格上限；更长的向量只画选中的那一段（一条 2390 维的判别器窗口画全是一面墙）。 */
const GRID_LIMIT = 1024;
/** 条形图一层最多并排多少段，再多每段就窄到点不中了，交给方格。 */
const BAR_LIMIT = 64;
/** 还没挂进页面、量不到宽度时，估算段宽用的条形图宽度（窄抽屉的偏小值）。 */
const BAR_WIDTH_FALLBACK = 290;
/** 方格里「每段另起一行」的段数上限，再多就挤在一起排。 */
const ROW_BREAK_LIMIT = 16;

const BASIS_TEXT = {
  edges:
    "分段 = 拼进来的上游模块，顺序按入边（校验脚本已与维度算式逐项核对）；段内按各模块自己的分量顺序展开。",
  layout: "按本模块「分量顺序」原文解析。",
  borrow: "原文写明与另一个模块同布局，按那个模块的分量顺序展开。",
  none: "原文没有逐个分量的写法，只能按位置标号。",
};

/**
 * @param {object} opts
 * @param {{size:number, layout:object, basis:string, borrowedFrom?:string}} opts.map
 * @param {string} opts.title           面板标题
 * @param {string} opts.color           本模块的分类色，没挂到模块的段用它
 * @param {object} opts.graph
 * @param {(id:string)=>void} [opts.onSelectNode]
 * @param {(n:object)=>string} opts.colorOf  节点 → 颜色
 * @param {{start:number,size:number}} [opts.focusRange] 预先选中的一段（连线详情里标出「落在哪」）
 * @param {string} [opts.caption]       标题下的一句说明
 */
export function renderIndexPanel(opts) {
  const { map, graph } = opts;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const root = el("div", { class: "ix" });
  const state = { focus: [], index: null };

  if (opts.focusRange) state.focus = focusForRange(map.layout, opts.focusRange);
  // 标量只有一格，直接把那一格的说明摊开，省得读者再点一下。
  if (map.size === 1) state.index = 0;

  // 顶层条形图在方格上面、下钻出来的几层在方格下面：点了之后长出来的东西都在下方，
  // 方格不会被往下推——否则刚点的那一格会从鼠标底下跑开。
  // 段宽按条形图的实际宽度估：右栏宽度随窗口变（宽屏 1/3、窄屏整宽），写死一个数
  // 要么在宽屏上把放得下的名字也藏掉，要么在窄栏里塞进一排残字。
  let barWidth = BAR_WIDTH_FALLBACK;
  const paint = () => {
    if (root.isConnected && root.clientWidth) barWidth = root.clientWidth;
    clear(root);
    const [top, ...drill] = bars();
    root.append(header(), top ?? "", map.size > 1 ? grid() : "", ...drill, card());
  };

  /* ---------- 选择 ---------- */

  const selectGroup = (level, group) => {
    // 一格的段就是一个 index：直接给出逐层路径，而不是一张只写「1 维」的卡。
    if (group.size === 1) return selectIndex(group.start);
    const same = state.focus[level] && sameGroup(state.focus[level], group) && state.index == null;
    // 再点一次同一段 = 退回上一层，方便读者「点错了往回走」。
    state.focus = same ? state.focus.slice(0, level) : [...state.focus.slice(0, level), group];
    state.index = null;
    paint();
  };

  const selectIndex = (i) => {
    if (i < 0 || i >= map.size) return;
    state.focus = focusForIndex(map.layout, i);
    state.index = i;
    paint();
  };

  /* ---------- 头部 ---------- */

  function header() {
    const top = groupsOf(map.layout);
    const basis =
      map.basis === "borrow" && map.borrowedFrom
        ? `原文写明与「${byId.get(map.borrowedFrom)?.label ?? map.borrowedFrom}」同布局，按那个模块的分量顺序展开。`
        : BASIS_TEXT[map.basis];
    return el("div", { class: "ix-head" }, [
      el("div", { class: "ix-title-row" }, [
        el("h3", { text: opts.title }),
        el("span", {
          class: "ix-meta",
          text: `${map.size} 维${
            top.length > 1
              ? ` · ${top.length} ${{ grid: "组", items: "个分量" }[map.layout.type] ?? "段"}`
              : ""
          }`,
        }),
      ]),
      opts.caption ? el("p", { class: "ix-caption", text: opts.caption }) : null,
      el("p", { class: "ix-basis", text: basis }),
    ]);
  }

  /* ---------- 条形图（逐层下钻） ---------- */

  function bars() {
    const out = [];
    let groups = groupsOf(map.layout);
    let inherited = opts.color;
    for (let level = 0; groups && groups.length; level += 1) {
      if (groups.length > BAR_LIMIT) {
        out.push(
          el("p", { class: "ix-note", text: `这一层有 ${groups.length} 组，太窄点不中，直接点方格。` }),
        );
        break;
      }
      out.push(bar(level, groups, inherited, state.focus[level - 1]));
      const chosen = state.focus[level];
      if (!chosen || !canDrill(chosen)) break;
      inherited = groupColor(chosen, inherited);
      groups = groupsOf(chosen.layout, chosen.start);
      if (groups.length < 2) break;
    }
    return out;
  }

  /** 选中链上第 level 层那一段的颜色：挂了模块用模块色，否则沿用上一层。 */
  function focusColor(level) {
    let c = opts.color;
    for (let k = 0; k <= level && k < state.focus.length; k += 1) c = groupColor(state.focus[k], c);
    return c;
  }

  function bar(level, groups, inherited, parent) {
    const chosen = state.focus[level];
    const total = groups.reduce((sum, g) => sum + g.size, 0);
    const first = groups[0].start;
    const last = groups[groups.length - 1].start + groups[groups.length - 1].size - 1;
    return el("div", { class: "ix-level", dataset: { level: String(level) } }, [
      parent ? el("div", { class: "ix-level-title", text: `「${parent.label}」内部：` }) : null,
      el(
        "div",
        { class: "ix-bar", role: "group", "aria-label": `第 ${level + 1} 层分段` },
        groups.map((g, k) => {
          const on = chosen && sameGroup(chosen, g);
          return el(
            "button",
            {
              class: `ix-seg${on ? " on" : ""}${chosen && !on ? " off" : ""}`,
              type: "button",
              style: { flexGrow: String(g.size), "--c": tone(groupColor(g, inherited), k) },
              "aria-pressed": on ? "true" : "false",
              title: `${g.label} · index ${range(g)}（${g.size} 维）`,
              onClick: () => selectGroup(level, g),
            },
            // 段内只放名字：宽度 ∝ 维数，名字放不下就被裁掉；窄到连一个字都放不下的段干脆
            // 不放，免得一排「左 | 右 | 腰」的残字。悬停与卡片里有全名。
            (g.size / total) * barWidth >= 22
              ? el("span", { class: "ix-seg-label", text: g.short ?? g.label })
              : null,
          );
        }),
      ),
      el("div", { class: "ix-ruler", "aria-hidden": "true" }, [
        el("span", { text: String(first) }),
        el("span", { text: String(last) }),
      ]),
    ]);
  }

  /* ---------- 方格 ---------- */

  function grid() {
    // 画哪一段：整条向量放得下就画整条；否则只画选中链上放得下的那一段。
    let span = { start: 0, size: map.size, layout: map.layout };
    if (map.size > GRID_LIMIT) {
      // 放得下的最浅那一段（一整帧而不是一个关节），读者看得见选中的那一小块在哪。
      const level = state.focus.findIndex((g) => g.size <= GRID_LIMIT);
      span = level >= 0 ? { ...state.focus[level], color: focusColor(level) } : null;
      if (!span) {
        return el("p", {
          class: "ix-note",
          text: `${map.size} 维一格一格画是一面墙：先在上面的条形图里点一段，方格只画那一段。`,
        });
      }
    }

    // 上色按「这一片方格里的下一层分组」，于是读者一眼看到它由哪几块拼成。
    const sub =
      span.layout && !span.whole && hasInner(span.layout) ? groupsOf(span.layout, span.start) : [span];
    const colorAt = new Array(span.size);
    const base = span.color ?? opts.color;
    sub.forEach((g, k) => {
      const c = tone(groupColor(g, base), k);
      for (let i = g.start; i < g.start + g.size; i += 1) colorAt[i - span.start] = c;
    });

    const deepest = state.focus[state.focus.length - 1];
    const lit = deepest ? [deepest.start, deepest.start + deepest.size] : null;
    const cells = [];
    for (let i = span.start; i < span.start + span.size; i += 1) {
      const outside = lit && (i < lit[0] || i >= lit[1]);
      cells.push(
        el("span", {
          class: `ix-cell${outside ? " off" : ""}${state.index === i ? " on" : ""}`,
          style: { "--c": colorAt[i - span.start] },
          dataset: { i: String(i) },
        }),
      );
    }

    const cols = gridCols(span, sub);
    const isSeq = span.layout?.type === "seq";
    // 分段不多时每段另起一行：方格读起来就是「一行一项观测」，而不是一片不分家的色块。
    // 但全是标量的拼接（倒立摆的 4 维）别排成一竖列；每段另起一行也不能把方格拉得比挤着排高出太多。
    const rowsIfBroken = sub.reduce((n, g) => n + Math.ceil(g.size / cols), 0);
    const rowPerPart =
      isSeq &&
      sub.length > 1 &&
      sub.length <= ROW_BREAK_LIMIT &&
      sub.some((g) => g.size >= 3) &&
      rowsIfBroken <= 2 * Math.ceil(span.size / cols) + 2;
    if (rowPerPart) {
      for (const g of sub) cells[g.start - span.start].style.gridColumnStart = "1";
    }
    const box = el(
      "div",
      {
        class: "ix-grid",
        "aria-hidden": "true",
        style: { "--cols": String(cols), gap: cols > 24 ? "1px" : "2px" },
        onClick: (event) => {
          const cell = event.target.closest?.(".ix-cell");
          if (cell) selectIndex(Number(cell.dataset.i));
        },
      },
      cells,
    );
    // 悬停看 index 号：一个 title 挂在容器上随鼠标改，省得给上千个格子各挂一个。
    box.addEventListener("mouseover", (event) => {
      const cell = event.target.closest?.(".ix-cell");
      if (cell)
        box.title = `index ${cell.dataset.i}：${locate(map.layout, Number(cell.dataset.i))
          .map((s) => s.label)
          .join(" › ")}`;
    });

    return el("div", { class: "ix-grid-wrap" }, [
      span.size < map.size
        ? el("p", { class: "ix-note", text: `只画 index ${range(span)}（${span.size} 维）这一段。` })
        : null,
      box,
      el("p", {
        class: "ix-legend",
        "aria-hidden": "true",
        text: rowPerPart
          ? `每格一个数，每段另起一行（一行最多 ${cols} 格）；点任意一格看它是什么。`
          : `每格一个数，一行 ${cols} 格；点任意一格看它是什么。`,
      }),
    ]);
  }

  /* ---------- 说明卡 ---------- */

  function card() {
    const box = el("div", { class: "ix-card", "aria-live": "polite" });

    if (state.index == null && !state.focus.length) {
      box.append(
        el("p", { class: "ix-hint", text: "点条形图里的一段看那一组 index，或点任意一格看那一个数。" }),
      );
      return box;
    }

    if (state.index != null) {
      const path = locate(map.layout, state.index);
      const leaf = path[path.length - 1];
      box.append(
        el("div", { class: "ix-card-head" }, [
          el("strong", { class: "ix-card-idx", text: `index ${state.index}` }),
          el("span", { class: "ix-step" }, [
            el("button", {
              class: "ix-step-btn",
              type: "button",
              "aria-label": "上一个 index",
              disabled: state.index === 0,
              text: "‹",
              onClick: () => selectIndex(state.index - 1),
            }),
            el("button", {
              class: "ix-step-btn",
              type: "button",
              "aria-label": "下一个 index",
              disabled: state.index === map.size - 1,
              text: "›",
              onClick: () => selectIndex(state.index + 1),
            }),
          ]),
        ]),
        el(
          "div",
          { class: "ix-path" },
          path.flatMap((step, k) => [
            k ? el("span", { class: "ix-path-sep", "aria-hidden": "true", text: "›" }) : null,
            el("span", { class: `ix-path-step${k === path.length - 1 ? " leaf" : ""}`, text: step.label }),
          ]),
        ),
      );
      // 每一层的位置：「第 3 段 index 73–101 里的第 3 个」比一个裸的 75 好对代码。
      const where = path
        .filter((s) => s.kind !== "item" && s.kind !== "opaque")
        .map((s) => `${s.label}：index ${s.start}–${s.start + s.size - 1}`);
      if (where.length) box.append(el("p", { class: "ix-where", text: where.join("；") }));
      box.append(
        el("p", {
          class: "ix-where",
          text: `在最内一层是第 ${leaf.pos + 1} 个，共 ${leaf.of ?? 1} 个。`,
        }),
      );
      const text = [...path].reverse().find((s) => s.text)?.text;
      if (text) box.append(el("p", { class: "ix-text", text }));
      if (!leaf.named) {
        box.append(
          el("p", {
            class: "ix-warn",
            text:
              leaf.kind === "opaque"
                ? "数据在这一层只写了名字与维数，没写逐个分量，所以这里只给位置。"
                : "数据只写了这一层的排序规则，没逐个列出名字，所以这里只给序号。",
          }),
        );
      }
      const owner = [...path].reverse().find((s) => s.nodeId);
      if (owner) box.append(moduleLink(owner.nodeId));
      return box;
    }

    const g = state.focus[state.focus.length - 1];
    box.append(
      el("div", { class: "ix-card-head" }, [
        el("strong", { class: "ix-card-idx", text: `index ${range(g)}` }),
        el("span", { class: "ix-meta", text: `${g.size} 维` }),
      ]),
      el("p", { class: "ix-card-label", text: g.label }),
    );
    if (g.text && g.text !== g.label) box.append(el("p", { class: "ix-text", text: g.text }));
    if (g.linkedBy === "edge") {
      box.append(
        el("p", {
          class: "ix-warn",
          text: "这一段按「有入边、维数独一份」对上了上游模块，是推断；原文只写了名字与维数。",
        }),
      );
    }
    if (g.nodeId) box.append(moduleLink(g.nodeId));
    if (canDrill(g)) {
      box.append(el("p", { class: "ix-hint", text: "上面多出的一条是它内部的分段；再点一次这一段可退回。" }));
    }
    return box;
  }

  function moduleLink(id) {
    const n = byId.get(id);
    if (!n || !opts.onSelectNode) return el("p", { class: "ix-where", text: `来自模块：${n?.label ?? id}` });
    return el(
      "button",
      {
        class: "dd-edge ix-module",
        type: "button",
        style: { "--edge-color": opts.colorOf(n) },
        title: "打开这个模块的详情",
        onClick: () => opts.onSelectNode(id),
      },
      [
        el("span", { class: "dd-edge-name", text: n.label }),
        el("span", { class: "dd-edge-tag", text: "来自模块" }),
      ],
    );
  }

  function groupColor(g, inherited = opts.color) {
    const n = g.nodeId ? byId.get(g.nodeId) : null;
    return n ? opts.colorOf(n) : inherited;
  }

  paint();
  // 首次绘制时面板还没挂进页面，量不到宽度；挂上之后按实测宽度再画一遍
  // （同一帧内完成，读者看不到第一遍）。
  requestAnimationFrame(() => {
    if (root.isConnected && Math.abs(root.clientWidth - barWidth) > 24) paint();
  });
  return root;
}

/* ---------- 纯函数 ---------- */

function canDrill(g) {
  return Boolean(g.layout) && !g.whole && g.size > 1 && hasInner(g.layout);
}

function sameGroup(a, b) {
  return a.start === b.start && a.size === b.size;
}

function range(g) {
  return g.size === 1 ? String(g.start) : `${g.start}–${g.start + g.size - 1}`;
}

/** 从外到内，每层取包含第 i 个数的那一组。 */
function focusForIndex(layout, i) {
  const focus = [];
  let groups = groupsOf(layout);
  while (groups && groups.length && groups.length <= BAR_LIMIT) {
    const g = groups.find((x) => i >= x.start && i < x.start + x.size);
    if (!g) break;
    focus.push(g);
    if (!canDrill(g)) break;
    groups = groupsOf(g.layout, g.start);
    if (groups.length < 2) break;
  }
  return focus;
}

/** 预选一段：逐层往下找，直到某一层正好是这一段。 */
function focusForRange(layout, target) {
  const focus = [];
  let groups = groupsOf(layout);
  while (groups && groups.length <= BAR_LIMIT) {
    const g = groups.find((x) => target.start >= x.start && target.start + target.size <= x.start + x.size);
    if (!g) break;
    focus.push(g);
    if (sameGroup(g, target) || !canDrill(g)) break;
    groups = groupsOf(g.layout, g.start);
  }
  return focus;
}

/**
 * 方格一行几格：内层是「帧 × 29 关节」这种重复结构时，一行正好一帧，读者能看见
 * 「这一行是同一帧」；拼接向量按段长取；否则按总数挑一个读得动的宽度。
 */
function gridCols(span, sub) {
  const l = span.layout;
  if (l?.type === "grid" && l.inner.size >= 2 && l.inner.size <= 40) return l.inner.size;
  if (span.size <= 12) return span.size;
  // 拼接向量：最大的那一段若是「帧 × 29 关节」，就按它的周期排，一行正好一帧；
  // 否则取各段里 ≤ 40 的最大段长，于是「29 个关节」正好一行、58 维的参考是两行。
  if (l?.type === "seq" && sub.length > 1 && sub.length <= ROW_BREAK_LIMIT) {
    const biggest = sub.reduce((a, b) => (b.size > a.size ? b : a));
    const period = biggest.layout?.type === "grid" ? biggest.layout.inner.size : 0;
    if (period >= 10 && period <= 40) return period;
    const widest = Math.max(...sub.map((g) => g.size).filter((n) => n <= 40));
    if (widest >= 6) return widest;
  }
  if (span.size <= 240) return 20;
  if (span.size <= 600) return 30;
  return 40;
}

/** 相邻两段同色时靠明暗区分：奇数段掺白。分类色都是亮色、上面压深色字，往白里掺两个主题下都读得清。 */
function tone(color, k) {
  return k % 2 ? `color-mix(in srgb, ${color} 55%, #fff)` : color;
}
