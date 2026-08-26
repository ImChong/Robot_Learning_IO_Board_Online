/** 节点图渲染：HTML 节点卡片 + SVG 连线，缩放平移，链路高亮，模式补间。 */

import { el, svgEl, clear } from "./dom.js";
import { nodeColor } from "./data.js";
import { computeLayout, forwardPath, channelPath, siblingPath, NODE_W } from "./layout.js";

const TOP_CHANNEL_KINDS = new Set(["obs", "ref", "privileged", "latent"]);
const MIN_SCALE = 0.25;
const MAX_SCALE = 1.6;
const FALLBACK_NODE_H = 66;

export function createGraphView({ canvas, viewport, svg, nodesLayer, taxonomy, onSelect }) {
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

  ensureMarkers(svg, taxonomy);

  /* ---------- 缩放平移 ---------- */

  function applyTransform() {
    viewport.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  }

  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!layout) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.k * factor));
      const ratio = next / view.k;
      view.x = cx - (cx - view.x) * ratio;
      view.y = cy - (cy - view.y) * ratio;
      view.k = next;
      applyTransform();
    },
    { passive: false }
  );

  let dragging = null;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".node")) return;
    dragging = { px: event.clientX, py: event.clientY, ox: view.x, oy: view.y };
    canvas.classList.add("dragging");
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    view.x = dragging.ox + (event.clientX - dragging.px);
    view.y = dragging.oy + (event.clientY - dragging.py);
    applyTransform();
  });
  const endDrag = () => {
    dragging = null;
    canvas.classList.remove("dragging");
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  function fit() {
    if (!layout) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const padX = 30;
    const padY = 12;
    // 回路通道画在图的上下方，缩放时要把它们的高度一起算进去，否则会被裁掉。
    const contentH = layout.height + margins.top + margins.bottom;
    const k = Math.min(
      MAX_SCALE,
      Math.max(
        MIN_SCALE,
        Math.min((rect.width - padX * 2) / layout.width, (rect.height - padY * 2) / contentH)
      )
    );
    view.k = k;
    view.x = (rect.width - layout.width * k) / 2;
    view.y = (rect.height - contentH * k) / 2 + margins.top * k;
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
    const target = event.target.closest(".node");
    if (!target) return;
    const id = target.dataset.id;
    selectedId = selectedId === id ? null : id;
    paintHighlight();
    onSelect?.(selectedId ? graph.nodes.find((n) => n.id === selectedId) : null);
  });

  nodesLayer.addEventListener("pointerover", (event) => {
    const target = event.target.closest(".node");
    const id = target?.dataset.id ?? null;
    if (id === hoveredId) return;
    hoveredId = id;
    paintHighlight();
  });
  nodesLayer.addEventListener("pointerleave", () => {
    hoveredId = null;
    paintHighlight();
  });
  nodesLayer.addEventListener("focusin", (event) => {
    const target = event.target.closest(".node");
    if (!target) return;
    hoveredId = target.dataset.id;
    paintHighlight();
  });
  nodesLayer.addEventListener("focusout", () => {
    hoveredId = null;
    paintHighlight();
  });

  window.addEventListener("resize", () => fit());

  return {
    render,
    fit,
    setFilters(next) {
      filters = next;
      paintFilters();
    },
    select(id) {
      selectedId = id;
      paintHighlight();
      if (!id) return;
      nodeEls.get(id)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
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
