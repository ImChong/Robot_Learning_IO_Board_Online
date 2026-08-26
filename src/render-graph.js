/** 节点图渲染：HTML 节点卡片 + SVG 连线，缩放平移，链路高亮，模式补间。 */

import { el, svgEl, clear } from "./dom.js";
import { nodeColor } from "./data.js";
import { computeLayout, forwardPath, channelPath, siblingPath, NODE_W } from "./layout.js";

const TOP_CHANNEL_KINDS = new Set(["obs", "ref", "privileged", "latent"]);
const MIN_SCALE = 0.25;
const MAX_SCALE = 1.6;
const FALLBACK_NODE_H = 66;
// 小画布上「整张图塞进去」会把卡片压到 0.3 倍，字全糊掉。宁可停在还读得清的
// 比例上让读者拖，也不给一张看不清的全景——真想看全景，捏合缩小就是。
// 横屏手机是矮而不是窄，所以两个方向都要判。
const COMPACT_W = 720;
const COMPACT_H = 420;
const MIN_READABLE_SCALE = 0.52;
// 手指按下到判定为拖动之间的容差：太小则点按会被当成拖动，太大则拖动起步发滞。
const DRAG_SLOP = 6;

export function createGraphView({
  canvas,
  viewport,
  svg,
  nodesLayer,
  taxonomy,
  overlays = [],
  onSelect,
  onTourJump,
}) {
  const view = { x: 0, y: 0, k: 1 };
  let graph = null;
  let layout = null;
  let nodeEls = new Map();
  let selectedId = null;
  let hoveredId = null;
  let filters = null;
  let upstream = new Map();
  let downstream = new Map();
  let margins = { top: 48, bottom: 48 };
  let touched = new Set();
  // 讲解态：{ currentId, visited:Set }。非空时接管整张图的明暗。
  let tour = null;

  ensureMarkers(svg, taxonomy);

  /* ---------- 缩放平移 ---------- */

  function applyTransform() {
    viewport.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  }

  const clampScale = (k) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, k));

  /** 以画布内的某一点为锚缩放：那一点下面的内容不动。 */
  function zoomAt(cx, cy, factor) {
    const next = clampScale(view.k * factor);
    const ratio = next / view.k;
    view.x = cx - (cx - view.x) * ratio;
    view.y = cy - (cy - view.y) * ratio;
    view.k = next;
    applyTransform();
  }

  function zoomBy(factor) {
    if (!layout) return;
    const rect = canvas.getBoundingClientRect();
    zoomAt(rect.width / 2, rect.height / 2, factor);
  }

  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!layout) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.0015));
    },
    { passive: false }
  );

  /**
   * 触摸与鼠标走同一套指针记账：一根手指平移，两根手指同时捏合缩放与平移。
   * 每次手指增减都以当前视图为基准重新起算，所以放开一根手指不会让画面跳一下。
   */
  const pointers = new Map();
  let gesture = null;
  let dragMoved = false;

  const centroid = () => {
    const list = [...pointers.values()];
    const x = list.reduce((sum, p) => sum + p.x, 0) / list.length;
    const y = list.reduce((sum, p) => sum + p.y, 0) / list.length;
    return { x, y };
  };

  const spread = () => {
    const list = [...pointers.values()];
    if (list.length < 2) return 0;
    return Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
  };

  function rebaseGesture() {
    if (!pointers.size) {
      gesture = null;
      canvas.classList.remove("dragging");
      return;
    }
    const center = centroid();
    gesture = { cx: center.x, cy: center.y, dist: spread(), ox: view.x, oy: view.y, ok: view.k };
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!layout) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest(".canvas-zoom")) return;
    if (!pointers.size) dragMoved = false;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    rebaseGesture();
  });

  window.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const center = centroid();
    const pinching = pointers.size > 1 && gesture.dist > 0;
    // 起手容差只挡单指：两指落下必定是要操作画布，没有「点按」这层歧义。
    if (!dragMoved) {
      const slipped = Math.hypot(center.x - gesture.cx, center.y - gesture.cy) >= DRAG_SLOP;
      if (!pinching && !slipped) return;
      dragMoved = true;
      canvas.classList.add("dragging");
    }

    const rect = canvas.getBoundingClientRect();
    const k = pinching ? clampScale(gesture.ok * (spread() / gesture.dist)) : gesture.ok;
    const ratio = k / gesture.ok;
    view.k = k;
    view.x = center.x - rect.left - (gesture.cx - rect.left - gesture.ox) * ratio;
    view.y = center.y - rect.top - (gesture.cy - rect.top - gesture.oy) * ratio;
    applyTransform();
  });

  const releasePointer = (event) => {
    if (!pointers.delete(event.pointerId)) return;
    rebaseGesture();
  };
  window.addEventListener("pointerup", releasePointer);
  window.addEventListener("pointercancel", releasePointer);

  let lastFitWidth = 0;

  function fit() {
    if (!layout) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    lastFitWidth = rect.width;
    const padX = 30;
    const padY = 12;
    // 回路通道画在图的上下方，缩放时要把它们的高度一起算进去，否则会被裁掉。
    const contentH = layout.height + margins.top + margins.bottom;
    const exact = Math.min((rect.width - padX * 2) / layout.width, (rect.height - padY * 2) / contentH);
    const compact = rect.width < COMPACT_W || rect.height < COMPACT_H;
    const k = clampScale(compact ? Math.max(exact, MIN_READABLE_SCALE) : exact);
    view.k = k;

    // 横向放不下时贴左边起排，读者从输入侧往右拖——这正是图本身的阅读顺序。
    // 纵向始终居中：每条泳道的模块都是绕中线排的，贴顶只会看到一片空的回路通道。
    const contentW = layout.width * k;
    view.x = contentW <= rect.width - padX * 2 ? (rect.width - contentW) / 2 : padX;
    view.y = (rect.height - contentH * k) / 2 + margins.top * k;
    applyTransform();
  }

  /**
   * 浮层（详情、讲解）盖住了画布的哪一条边。窄屏上它们贴底，矮而宽的视口上
   * 讲解面板改贴右——这里不去猜是哪条 CSS 规则生效了，直接看浮层的盒子落在
   * 画布的哪一侧。
   */
  function overlayInsets(rect) {
    let bottom = 0;
    let right = 0;
    for (const overlay of overlays) {
      if (!overlay || overlay.hidden) continue;
      const style = getComputedStyle(overlay);
      if (style.position !== "fixed" || style.visibility === "hidden") continue;
      const box = overlay.getBoundingClientRect();
      if (box.left > rect.left + rect.width / 2) {
        right = Math.max(right, rect.right - box.left);
      } else {
        // 贴底浮层量的是布局高度而不是 rect：浮层正在滑入时 rect 读到的是动画中途。
        bottom = Math.max(bottom, rect.bottom - (window.innerHeight - overlay.offsetHeight));
      }
    }
    return { bottom: Math.max(0, bottom), right: Math.max(0, right) };
  }

  /**
   * 把某个模块挪进可视范围。用平移而不是 scrollIntoView：画布是 overflow:hidden
   * 的变换容器，让浏览器去滚它会把内容整体推走、和 transform 对不上。
   */
  function reveal(id) {
    const box = layout?.pos.get(id);
    if (!box) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const pad = 24;
    const inset = overlayInsets(rect);
    const floor = rect.height - inset.bottom;
    const wall = rect.width - inset.right;
    const left = view.x + box.x * view.k;
    const top = view.y + box.y * view.k;
    const right = left + box.w * view.k;
    const bottom = top + box.h * view.k;
    if (left < pad) view.x += pad - left;
    else if (right > wall - pad) view.x -= right - (wall - pad);
    if (top < pad) view.y += pad - top;
    else if (bottom > floor - pad) view.y -= bottom - (floor - pad);
    applyTransform();
  }

  /* ---------- 高亮 ---------- */

  function buildAdjacency() {
    upstream = new Map();
    downstream = new Map();
    for (const edge of graph.edges) {
      if (!downstream.has(edge.from)) downstream.set(edge.from, []);
      downstream.get(edge.from).push(edge.to);
      if (!upstream.has(edge.to)) upstream.set(edge.to, []);
      upstream.get(edge.to).push(edge.from);
    }
  }

  function reachable(startId, adjacency) {
    const seen = new Set();
    const queue = [startId];
    while (queue.length) {
      const id = queue.pop();
      for (const next of adjacency.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  }

  function activeChain() {
    const focus = hoveredId ?? selectedId;
    if (!focus) return null;
    const chain = new Set([focus, ...reachable(focus, upstream), ...reachable(focus, downstream)]);
    return chain;
  }

  function paintHighlight() {
    if (tour) {
      paintTour();
      return;
    }
    const chain = activeChain();
    for (const [id, node] of nodeEls) {
      node.classList.toggle("dimmed", Boolean(chain) && !chain.has(id));
      node.classList.toggle("selected", id === selectedId);
    }
    for (const path of svg.querySelectorAll("[data-from]")) {
      const inChain = chain && chain.has(path.dataset.from) && chain.has(path.dataset.to);
      path.classList.toggle("dimmed", Boolean(chain) && !inChain);
      path.classList.toggle("active", Boolean(inChain));
    }
  }

  /**
   * 讲解态的明暗：讲过的保持正常，当前这个打高亮，还没讲到的压暗。
   * 于是整条链路是「随着讲解一格一格亮起来」，而不是每步只亮一个孤零零的框。
   */
  function paintTour() {
    const { currentId, visited } = tour;
    for (const [id, element] of nodeEls) {
      const done = visited.has(id) && id !== currentId;
      element.classList.toggle("tour-current", id === currentId);
      element.classList.toggle("tour-done", done);
      element.classList.toggle("dimmed", !done && id !== currentId);
      element.classList.remove("selected");
    }
    for (const path of svg.querySelectorAll("[data-from]")) {
      const { from, to } = path.dataset;
      // 正在讲的这一步：入边加粗，读者一眼看到「这一格的输入是从哪来的」。
      const active = to === currentId && visited.has(from);
      const walked = visited.has(from) && visited.has(to);
      path.classList.toggle("active", active);
      path.classList.toggle("dimmed", !walked);
    }
  }

  /* ---------- 筛选 ---------- */

  function paintFilters() {
    if (!graph) return;
    for (const node of graph.nodes) {
      const element = nodeEls.get(node.id);
      if (!element) continue;
      element.classList.toggle("filtered-out", !passesFilters(node, filters));
    }
  }

  function passesFilters(node, active) {
    if (!active) return true;
    if (active.classes?.size && node.class && !active.classes.has(node.class)) return false;
    if (active.availability?.size) {
      const key = node.availability ?? "n/a";
      if (!active.availability.has(key)) return false;
    }
    if (active.confidence?.size && !active.confidence.has(node.confidence)) return false;
    return true;
  }

  /* ---------- 节点卡片 ---------- */

  function buildNode(node) {
    const color = nodeColor(node, taxonomy);
    const cls = node.class ? taxonomy.classById.get(node.class) : null;
    const acq = node.acquisition ? taxonomy.acquisitionById.get(node.acquisition) : null;
    const conf = taxonomy.confidenceById.get(node.confidence);

    const top = el("div", { class: "node-top" }, [
      cls ? el("span", { class: "node-class", text: cls.id, title: cls.name }) : null,
      acq && acq.id !== "none"
        ? el("span", { class: "node-acq", text: acq.icon, title: acq.name })
        : null,
      conf?.badge ? el("span", { class: "node-conf", text: conf.badge, title: conf.name }) : null,
    ]);

    const button = el(
      "button",
      {
        type: "button",
        class: "node",
        dataset: { id: node.id },
        style: { "--node-color": color },
        "aria-describedby": "drawer",
      },
      [
        top,
        el("div", { class: "node-label", text: node.label }),
        node.sub ? el("div", { class: "node-sub", text: node.sub, title: node.sub }) : null,
        node.dim != null
          ? el("div", { class: "node-dim" }, [
              el("b", { text: String(node.dim) }),
              node.dimExpr ? ` = ${node.dimExpr}` : " 维",
            ])
          : null,
      ]
    );
    return button;
  }

  function decorate(element, node) {
    element.classList.toggle("train-only", node.availability === "train-only");
    element.classList.toggle("deploy-hard", node.availability === "deploy-hard");
    element.classList.toggle("sim-only", node.availability === "sim-only");
    element.classList.toggle("touched", touched.has(node.id));
    element.style.setProperty("--node-color", nodeColor(node, taxonomy));
  }

  /* ---------- 连线 ---------- */

  function drawEdges() {
    clear(svg);
    ensureMarkers(svg, taxonomy);

    const backward = [];
    const forward = [];
    const sibling = [];
    for (const edge of graph.edges) {
      const a = layout.pos.get(edge.from);
      const b = layout.pos.get(edge.to);
      if (!a || !b) continue;
      if (Math.abs(a.x - b.x) < 1) sibling.push({ edge, a, b });
      else (b.x > a.x ? forward : backward).push({ edge, a, b });
    }

    // 回路边按跨度排序，跨度大的排到通道外侧，避免互相压线。
    const top = backward
      .filter((item) => TOP_CHANNEL_KINDS.has(item.edge.kind))
      .sort((p, q) => q.a.x - q.b.x - (p.a.x - p.b.x));
    const bottom = backward
      .filter((item) => !TOP_CHANNEL_KINDS.has(item.edge.kind))
      .sort((p, q) => q.a.x - q.b.x - (p.a.x - p.b.x));

    const group = svgEl("g");
    const labels = svgEl("g");

    for (const { edge, a, b } of forward) {
      const y1 = a.y + a.h / 2;
      const y2 = b.y + b.h / 2;
      addEdge(group, labels, edge, forwardPath(a.x + a.w, y1, b.x, y2), (a.x + a.w + b.x) / 2, (y1 + y2) / 2);
    }

    for (const { edge, a, b } of sibling) {
      const y1 = a.y + a.h / 2;
      const y2 = b.y + b.h / 2;
      addEdge(group, labels, edge, siblingPath(a.x, y1, y2), a.x - 30, (y1 + y2) / 2);
    }

    top.forEach((item, i) => {
      const { edge, a, b } = item;
      const y = -26 - i * 13;
      const y1 = a.y + a.h / 2;
      const y2 = b.y + b.h / 2;
      addEdge(group, labels, edge, channelPath(a.x + a.w, y1, b.x, y2, y), (a.x + a.w + b.x) / 2, y - 5);
    });

    bottom.forEach((item, i) => {
      const { edge, a, b } = item;
      const y = layout.height + 26 + i * 13;
      const y1 = a.y + a.h / 2;
      const y2 = b.y + b.h / 2;
      addEdge(group, labels, edge, channelPath(a.x + a.w, y1, b.x, y2, y), (a.x + a.w + b.x) / 2, y - 5);
    });

    svg.append(group, labels);

    if (top.length) {
      labels.append(
        svgEl("text", { class: "channel-label", x: 0, y: -26 - top.length * 13 - 8, text: "传感与参考回路" })
      );
    }
    if (bottom.length) {
      labels.append(
        svgEl("text", {
          class: "channel-label",
          x: 0,
          y: layout.height + 26 + bottom.length * 13 + 4,
          text: "训练回路（部署时消失）",
        })
      );
    }

    margins = {
      top: top.length ? top.length * 13 + 46 : 24,
      bottom: bottom.length ? bottom.length * 13 + 46 : 24,
    };
    const pad = Math.max(margins.top, margins.bottom);
    const boxLeft = -60; // 同列边向左鼓出，以及通道走线的左侧转角
    const boxW = layout.width + 100;
    svg.setAttribute("width", boxW);
    svg.setAttribute("height", layout.height + pad * 2);
    svg.style.top = `${-pad}px`;
    svg.style.left = `${boxLeft}px`;
    svg.setAttribute("viewBox", `${boxLeft} ${-pad} ${boxW} ${layout.height + pad * 2}`);
  }

  function addEdge(group, labels, edge, d, labelX, labelY) {
    const kind = taxonomy.edgeKindById.get(edge.kind);
    const color = kind?.color ?? "#7d8794";
    group.append(
      svgEl("path", {
        class: `edge${edge.style === "dashed" ? " dashed" : ""}`,
        d,
        stroke: color,
        "marker-end": `url(#arrow-${edge.kind})`,
        "data-from": edge.from,
        "data-to": edge.to,
      })
    );
    if (edge.label) {
      labels.append(
        svgEl("text", {
          class: "edge-label",
          x: labelX,
          y: labelY,
          "text-anchor": "middle",
          text: edge.label,
          "data-from": edge.from,
          "data-to": edge.to,
        })
      );
    }
  }

  /* ---------- 泳道标题 ---------- */

  function drawLaneHeads() {
    for (const head of nodesLayer.querySelectorAll(".lane-head")) head.remove();
    for (const box of layout.laneBoxes) {
      const lane = taxonomy.laneById.get(box.id);
      nodesLayer.append(
        el("div", {
          class: "lane-head",
          text: lane?.name ?? box.id,
          style: { left: `${box.x}px`, top: "0px", width: `${NODE_W}px` },
        })
      );
    }
  }

  /* ---------- 渲染 ---------- */

  function render(nextGraph, { animate = false, touchedIds = null } = {}) {
    const previous = layout;
    graph = nextGraph;
    // 消融式项目：只有被 overrides 改动的模块闪一下，读者一眼看到「只有这两个框变了」。
    touched = touchedIds ?? new Set();
    buildAdjacency();

    const wanted = new Map(graph.nodes.map((node) => [node.id, node]));
    const nextEls = new Map();

    // 复用同 id 的卡片，让模式切换能做位置补间。
    for (const [id, element] of nodeEls) {
      if (wanted.has(id)) continue;
      element.classList.add("leaving");
      element
        .animate([{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.9 }], {
          duration: animate ? 220 : 0,
          easing: "ease-out",
        })
        .addEventListener("finish", () => element.remove());
    }

    for (const node of graph.nodes) {
      let element = nodeEls.get(node.id);
      const isNew = !element;
      if (isNew) {
        element = buildNode(node);
        nodesLayer.append(element);
      } else {
        const rebuilt = buildNode(node);
        clear(element).append(...rebuilt.childNodes);
      }
      decorate(element, node);
      element.dataset.new = isNew ? "1" : "";
      nextEls.set(node.id, element);
    }
    nodeEls = nextEls;

    // 量高度 → 排版 → 落位。offsetHeight 不受 viewport 的 transform 影响。
    const heights = new Map();
    for (const [id, element] of nodeEls) {
      heights.set(id, element.offsetHeight || FALLBACK_NODE_H);
    }
    layout = computeLayout(graph, heights);

    for (const [id, element] of nodeEls) {
      const box = layout.pos.get(id);
      const target = `translate(${box.x}px, ${box.y}px)`;
      const fresh = element.dataset.new === "1";
      if (fresh) {
        element.style.transform = target;
        element.style.opacity = "0";
        element.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: animate ? 260 : 0,
          delay: animate ? 140 : 0,
          easing: "ease-out",
          fill: "forwards",
        });
        element.style.opacity = "";
      } else if (animate) {
        const from = element.style.transform || target;
        element.style.transform = target;
        element.animate([{ transform: from }, { transform: target }], {
          duration: 320,
          easing: "cubic-bezier(.22,.61,.36,1)",
        });
      } else {
        element.style.transform = target;
      }
      element.dataset.new = "";
    }

    drawLaneHeads();
    drawEdges();

    if (animate) {
      svg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 120, easing: "ease-out" });
    }

    nodesLayer.style.width = `${layout.width}px`;
    nodesLayer.style.height = `${layout.height}px`;

    paintFilters();
    paintHighlight();

    const sameShape = previous && previous.width === layout.width;
    if (!sameShape || !animate) fit();
  }

  /* ---------- 事件 ---------- */

  nodesLayer.addEventListener("click", (event) => {
    // 从卡片上起手也能拖画布（手机上卡片盖住了大半个画布），代价是拖完那一下
    // 的 click 要吃掉，否则松手就会顺手选中脚下的模块。
    const wasDrag = dragMoved;
    dragMoved = false;
    // detail 为 0 说明这一下是键盘敲出来的，跟刚才那次拖动无关。
    if (wasDrag && event.detail > 0) return;
    const target = event.target.closest(".node");
    if (!target) return;
    const id = target.dataset.id;
    if (tour) {
      onTourJump?.(id);
      return;
    }
    selectedId = selectedId === id ? null : id;
    paintHighlight();
    onSelect?.(selectedId ? graph.nodes.find((n) => n.id === selectedId) : null);
  });

  // 链路高亮只跟鼠标走：触屏上 pointerover 也会触发，但没有对应的移出事件，
  // 高亮会一直粘在最后点过的卡片上，把整张图压暗。
  nodesLayer.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "mouse") return;
    const target = event.target.closest(".node");
    const id = target?.dataset.id ?? null;
    if (id === hoveredId) return;
    hoveredId = id;
    paintHighlight();
  });
  nodesLayer.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "mouse") return;
    hoveredId = null;
    paintHighlight();
  });
  nodesLayer.addEventListener("focusin", (event) => {
    const target = event.target.closest(".node");
    // 只认键盘焦点。触屏点按也会让按钮拿到焦点，但那件事已经由「选中」表达过了，
    // 再让它驱动高亮，手指移开后压暗效果就摘不掉。
    if (!target || !target.matches(":focus-visible")) return;
    hoveredId = target.dataset.id;
    paintHighlight();
  });
  nodesLayer.addEventListener("focusout", () => {
    hoveredId = null;
    paintHighlight();
  });

  window.addEventListener("resize", () => {
    // 手机上地址栏收起、软键盘弹出都会触发 resize，但画布宽度没变。这时重排会把
    // 读者刚调好的平移缩放清掉，所以只在宽度真的变了（转屏、改窗口）时复位。
    const width = canvas.getBoundingClientRect().width;
    if (width && Math.abs(width - lastFitWidth) < 1) return;
    fit();
  });

  return {
    render,
    fit,
    zoomBy,
    setFilters(next) {
      filters = next;
      paintFilters();
    },
    select(id) {
      selectedId = id;
      paintHighlight();
      if (id) reveal(id);
    },
    /** @param {{currentId: string, visited: Set<string>}|null} next */
    setTour(next) {
      tour = next;
      canvas.classList.toggle("touring", Boolean(next));
      if (next) {
        selectedId = null;
        hoveredId = null;
      }
      paintHighlight();
      if (next?.currentId) reveal(next.currentId);
    },
    revealSelected() {
      if (selectedId) reveal(selectedId);
    },
    get selectedId() {
      return selectedId;
    },
  };
}

function ensureMarkers(svg, taxonomy) {
  if (svg.querySelector("defs")) return;
  const defs = svgEl("defs");
  for (const kind of taxonomy.edgeKinds) {
    defs.append(
      svgEl(
        "marker",
        {
          id: `arrow-${kind.id}`,
          viewBox: "0 0 8 8",
          refX: 7,
          refY: 4,
          markerWidth: 6,
          markerHeight: 6,
          orient: "auto-start-reverse",
        },
        [svgEl("path", { d: "M 0 0 L 8 4 L 0 8 z", fill: kind.color })]
      )
    );
  }
  svg.append(defs);
}
