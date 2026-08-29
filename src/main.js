/** 入口：状态、URL 路由、各视图的装配。 */

import { el, clear } from "./dom.js";
import { loadCore } from "./data.js";
import { touchedIds } from "./inherit.js";
import { createProjectPicker } from "./project-picker.js";
import { createGraphView } from "./render-graph.js";
import { renderDetail, renderEdgeDetail } from "./render-detail.js";
import { renderRewards } from "./render-rewards.js";
import { renderCompare } from "./render-compare.js";
import { renderTable } from "./render-table.js";
import { buildTour } from "./tour.js";
import { renderTour, dwellFor } from "./render-tour.js";

const VIEWS = [
  { id: "graph", label: "节点图" },
  { id: "compare", label: "对比" },
  { id: "table", label: "表格" },
];

const dom = {
  pickerTrigger: document.getElementById("picker-trigger"),
  pickerCurrent: document.getElementById("picker-current"),
  pickerPanel: document.getElementById("picker-panel"),
  pickerSearch: document.getElementById("picker-search"),
  pickerList: document.getElementById("picker-list"),
  pickerEmpty: document.getElementById("picker-empty"),
  loadBar: document.getElementById("load-bar"),
  projectHead: document.getElementById("project-head"),
  modeSwitch: document.getElementById("mode-switch"),
  viewSwitch: document.getElementById("view-switch"),
  filters: document.getElementById("filters"),
  modeSummary: document.getElementById("mode-summary"),
  legend: document.getElementById("legend"),
  legendBtn: document.getElementById("legend-btn"),
  fitBtn: document.getElementById("fit-btn"),
  flowBtn: document.getElementById("flow-btn"),
  tourBtn: document.getElementById("tour-btn"),
  tour: document.getElementById("tour"),
  themeBtn: document.getElementById("theme-toggle"),
  header: document.querySelector(".site-header"),
  toolbar: document.querySelector(".toolbar"),
  stage: document.querySelector(".stage"),
  canvas: document.getElementById("canvas"),
  canvasHint: document.getElementById("canvas-hint"),
  zoomIn: document.getElementById("zoom-in"),
  zoomOut: document.getElementById("zoom-out"),
  zoomFit: document.getElementById("zoom-fit"),
  viewport: document.getElementById("viewport"),
  edges: document.getElementById("edges"),
  nodes: document.getElementById("nodes"),
  drawer: document.getElementById("drawer"),
  drawerEmpty: document.getElementById("drawer-empty"),
  drawerBody: document.getElementById("drawer-body"),
  callouts: document.getElementById("callouts"),
  rewards: document.getElementById("rewards"),
  compare: document.getElementById("compare"),
  tableView: document.getElementById("table-view"),
  footer: document.getElementById("footer"),
};

const state = {
  projectId: null,
  modeId: "train",
  view: "graph",
  nodeId: null,
  // 选中的连线，键是 `from>to`。和 nodeId 互斥：抽屉一次只讲一件事。
  edgeKey: null,
  compareId: null,
  filters: { classes: new Set(), availability: new Set(), confidence: new Set() },
  tour: false,
  flow: true,
};

let core = null;
let graphView = null;
let picker = null;
let current = null; // 当前项目的完整数据
let renderToken = 0;
let pendingLoads = 0;
// 讲解：步骤表由当前这张图推出来（src/tour.js），换项目 / 换模式都会重建。
let tourSteps = [];
let tourIndex = 0;
let tourPlaying = false;
let tourTimer = null;

/* ---------- 加载指示 ---------- */

async function withLoading(promise) {
  pendingLoads += 1;
  dom.loadBar.hidden = false;
  try {
    return await promise;
  } finally {
    pendingLoads -= 1;
    if (pendingLoads === 0) dom.loadBar.hidden = true;
  }
}

/* ---------- URL ---------- */

function readUrl() {
  const params = new URLSearchParams(location.search);
  return {
    projectId: params.get("p"),
    modeId: params.get("mode"),
    view: params.get("view"),
    nodeId: params.get("n"),
    edgeKey: params.get("e"),
    compareId: params.get("vs"),
    tour: params.get("tour") === "1",
  };
}

function writeUrl({ replace = false } = {}) {
  const params = new URLSearchParams();
  params.set("p", state.projectId);
  params.set("mode", state.modeId);
  if (state.view !== "graph") params.set("view", state.view);
  if (state.view === "compare" && state.compareId) params.set("vs", state.compareId);
  if (state.view === "graph" && state.nodeId) params.set("n", state.nodeId);
  if (state.view === "graph" && state.edgeKey) params.set("e", state.edgeKey);
  // 只记「在讲解」，不记讲到第几步：每步都写一次历史，后退键就没法用了。
  if (state.view === "graph" && state.tour) params.set("tour", "1");
  const url = `${location.pathname}?${params}`;
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
}

/* ---------- 派生 ---------- */

const graph = () => current.modes[state.modeId];

const modeIdAt = (index) => Object.keys(current?.modes ?? {})[index] ?? null;

function defaultCompareId(projectId) {
  const entry = core.entryById.get(projectId);
  // 优先选同组的下一个项目：跨族对比有意思，但「先跟自己的邻居比」更常用。
  const sameGroup = core.entries.find((e) => e.id !== projectId && e.group === entry?.group);
  return sameGroup?.id ?? core.entries.find((e) => e.id !== projectId)?.id ?? null;
}

/* ---------- 顶部 ---------- */

function renderProjectHead() {
  clear(dom.projectHead);
  const p = current;
  const entry = core.entryById.get(p.id);
  const group = core.groups.find((g) => g.id === entry?.group);

  const facts = [];
  if (group) facts.push(["分类", group.name]);
  // 项目列表按这个日期排序，所以它必须在页面上出现——读者要能核对顺序。
  if (entry?.published) {
    facts.push(["发表", entry.venue ? `${entry.published} · ${entry.venue}` : entry.published]);
  }
  if (p.robot) {
    facts.push(["机器人", `${p.robot.name} · ${p.robot.dof} DoF`]);
    if (p.robot.trackedBodies) facts.push(["跟踪连杆", `${p.robot.trackedBodies} 个`]);
    if (p.robot.anchor) facts.push(["anchor", p.robot.anchor]);
  }
  if (p.rates) facts.push(["控制频率", `${p.rates.policyHz} Hz / 物理 ${p.rates.physicsHz} Hz`]);
  if (p.verifiedRef) facts.push(["核对于", p.verifiedRef]);

  const parentName = p.inherits ? core.entryById.get(p.inherits)?.name ?? p.inherits : null;

  // 注意：Node.append() 会把 null 转成字面量 "null" 的文本节点（不像 el() 会跳过），
  // 所以条件项必须先 filter 再展开。缺 subtitle / tagline 的项目也走这条路。
  const parts = [
    el("h1", { text: p.name }),
    p.subtitle ? el("span", { class: "ph-sub", text: p.subtitle }) : null,
    p.tagline ? el("p", { class: "ph-tagline", text: p.tagline }) : null,
    // 消融式项目：先告诉读者「这张图和谁几乎一样、差在哪」，否则他会以为自己没切成功。
    p.diffSummary
      ? el("p", { class: "ph-diff" }, [
          el("b", { text: `与 ${parentName} 的差别：` }),
          ` ${p.diffSummary}`,
        ])
      : null,
    el(
      "div",
      { class: "ph-facts" },
      facts.map(([key, value]) =>
        el("span", { class: "fact" }, [`${key} `, el("b", { text: value })])
      )
    ),
    el(
      "div",
      { class: "ph-links" },
      Object.entries(p.links ?? {}).map(([label, url]) =>
        el("a", { href: url, target: "_blank", rel: "noopener", text: label })
      )
    ),
  ];
  dom.projectHead.append(...parts.filter(Boolean));
}

function renderModeSwitch() {
  clear(dom.modeSwitch);
  for (const [modeId, mode] of Object.entries(current.modes)) {
    dom.modeSwitch.append(
      el("button", {
        type: "button",
        class: "mode-btn",
        role: "tab",
        "aria-selected": String(modeId === state.modeId),
        text: mode.label,
        onClick: () => setMode(modeId),
      })
    );
  }

  clear(dom.viewSwitch);
  for (const view of VIEWS) {
    dom.viewSwitch.append(
      el("button", {
        type: "button",
        class: "mode-btn",
        role: "tab",
        "aria-selected": String(view.id === state.view),
        text: view.label,
        onClick: () => setView(view.id),
      })
    );
  }
}

function renderFilters() {
  clear(dom.filters);
  dom.filters.hidden = state.view !== "graph";
  if (state.view !== "graph") return;

  const present = new Set(graph().nodes.map((n) => n.class).filter(Boolean));
  dom.filters.append(el("span", { class: "filter-label", text: "只看" }));

  for (const cls of [...core.taxonomy.inputClasses, ...core.taxonomy.outputClasses]) {
    if (!present.has(cls.id)) continue;
    dom.filters.append(chip(cls.id, cls.name, cls.color, state.filters.classes));
  }

  // 可得性筛选按本图实际出现的档位生成——MimicKit 系列没有「部署困难」而有「仅仿真存在」，
  // 写死三个按钮会在半数项目上给出点不动的死按钮。
  const AVAIL_CHIPS = {
    "deploy-hard": "#e5a765",
    "train-only": "#ff7b72",
    "sim-only": "#9aa4b2",
  };
  const availPresent = new Set(graph().nodes.map((n) => n.availability).filter(Boolean));
  for (const [id, color] of Object.entries(AVAIL_CHIPS)) {
    if (!availPresent.has(id)) continue;
    const name = core.taxonomy.availabilityById.get(id)?.name ?? id;
    dom.filters.append(chip(id, name, color, state.filters.availability));
  }

  dom.filters.append(chip("inferred", "推断待核", "#9aa4b2", state.filters.confidence));

  const active =
    state.filters.classes.size + state.filters.availability.size + state.filters.confidence.size;
  if (active) {
    dom.filters.append(
      el("button", { class: "chip", type: "button", text: "清除", onClick: clearFilters })
    );
  }
}

function chip(id, label, color, set) {
  return el(
    "button",
    {
      class: "chip",
      type: "button",
      "aria-pressed": String(set.has(id)),
      style: { "--chip-color": color },
      title: `只显示${label}`,
      onClick: () => {
        if (set.has(id)) set.delete(id);
        else set.add(id);
        applyFilters();
        renderFilters();
      },
    },
    [el("span", { class: "dot" }), id === label ? label : `${id} ${label}`]
  );
}

function clearFilters() {
  state.filters.classes.clear();
  state.filters.availability.clear();
  state.filters.confidence.clear();
  applyFilters();
  renderFilters();
}

function applyFilters() {
  const any =
    state.filters.classes.size || state.filters.availability.size || state.filters.confidence.size;
  graphView.setFilters(any ? state.filters : null);
}

/* ---------- 连线流动 ---------- */

const FLOW_KEY = "riob-flow";

/**
 * 默认跟随系统的「减少动态」偏好：读者在系统里说过少动，第一眼就该是一张静止的图。
 * 但那只是默认值——按钮点过之后以读者自己的选择为准，和主题一样记在 localStorage。
 */
function initialFlow() {
  try {
    const stored = localStorage.getItem(FLOW_KEY);
    if (stored === "on") return true;
    if (stored === "off") return false;
  } catch {
    /* 隐私模式下读不到就按系统偏好来 */
  }
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function setFlow(on, { persist = true } = {}) {
  state.flow = on;
  graphView.setFlow(on);
  dom.flowBtn.setAttribute("aria-pressed", String(on));
  dom.flowBtn.title = `${on ? "关闭" : "打开"}连线上的数据流动动画（快捷键 L）`;
  if (!persist) return;
  try {
    localStorage.setItem(FLOW_KEY, on ? "on" : "off");
  } catch {
    /* 同主题：写不进去也无所谓 */
  }
}

/* ---------- 图例 ---------- */

function renderLegend() {
  const t = core.taxonomy;
  clear(dom.legend);

  dom.legend.append(
    block("观测五类（按部署是否可得切）", t.inputClasses, (item) => [
      el("span", { class: "swatch", style: { background: item.color } }),
      el("span", {}, [el("span", { class: "lg-name", text: `${item.id} ${item.name}` })]),
    ]),
    block("输出五类（按流向哪里切）", t.outputClasses, (item) => [
      el("span", { class: "swatch", style: { background: item.color } }),
      el("span", {}, [
        el("span", { class: "lg-name", text: `${item.id} ${item.name}` }),
        el("span", { class: "lg-desc", text: item.hardware ? " · 下发硬件" : " · 不下发硬件" }),
      ]),
    ]),
    block("真机如何获得（卡片左上角图标）", t.acquisition.filter((a) => a.id !== "none"), (item) => [
      el("span", { class: "icon-sample", text: item.icon }),
      el("span", {}, [
        el("span", { class: "lg-name", text: item.name }),
        el("span", { class: "lg-desc", text: ` — ${item.desc}` }),
      ]),
    ]),
    block(
      "部署可得性（卡片边框）",
      [
        { name: "实线边框", desc: "部署可得" },
        { name: "点线边框", desc: "需要估计链路" },
        { name: "虚线 + 斜纹底", desc: "仅训练可见，部署时消失" },
        { name: "虚线 + 灰色内框", desc: "仅仿真存在：真机无此通道，但推理时照样在用" },
      ],
      (item) => [
        el("span", {
          class: "swatch",
          style: { background: "transparent", border: "1px solid var(--border-strong)" },
        }),
        el("span", {}, [
          el("span", { class: "lg-name", text: item.name }),
          el("span", { class: "lg-desc", text: ` — ${item.desc}` }),
        ]),
      ]
    ),
    block("连线类型（光点朝数据流向走 · 点任意一条线看它搬的是什么）", t.edgeKinds, (item) => [
      el("span", { class: "line-sample", style: { color: item.color } }),
      el("span", { class: "lg-name", text: item.name }),
    ]),
    block("可信度（卡片右上角角标）", t.confidence, (item) => [
      el("span", { class: "icon-sample", text: item.badge || "—" }),
      el("span", {}, [
        el("span", { class: "lg-name", text: item.name }),
        el("span", { class: "lg-desc", text: ` — ${item.desc}` }),
      ]),
    ])
  );
}

function block(title, items, renderItem) {
  return el("div", {}, [
    el("h3", { text: title }),
    el(
      "ul",
      {},
      items.map((item) => el("li", {}, renderItem(item)))
    ),
  ]);
}

/* ---------- 批注与页脚 ---------- */

function renderCallouts() {
  clear(dom.callouts);
  const items = graph().callouts ?? [];
  dom.callouts.hidden = state.view !== "graph" || !items.length;
  for (const item of items) {
    dom.callouts.append(
      el("div", { class: "callout" }, [el("h3", { text: item.title }), el("p", { text: item.body })])
    );
  }
}

function renderFooter() {
  clear(dom.footer);
  dom.footer.append(
    el("p", {
      text:
        `${current.name} 数据核对于 ${current.verifiedAt ?? "—"}（${current.verifiedRef ?? "—"}）` +
        ` · 共收录 ${core.entries.length} 个项目`,
    }),
    el("p", { class: "footer-links" }, [
      ...(core.registry.references ?? []).map((ref) =>
        el("a", { href: ref.url, target: "_blank", rel: "noopener", text: ref.label })
      ),
      el("a", {
        href: "https://github.com/ImChong/Robot_Learning_IO_Board_Online",
        target: "_blank",
        rel: "noopener",
        text: "源码与数据",
      }),
    ]),
    // 署名行的写法和 imchong.github.io / Robot_Joint_Order_Check_Tool 一致。
    el("p", { class: "footer-copyright" }, [
      "© ",
      el("a", {
        href: "https://imchong.github.io/index.html",
        target: "_blank",
        rel: "noopener",
        text: "刘冲",
      }),
      ` ${new Date().getFullYear()} · 机器人学习输入输出分析板`,
    ])
  );
}

/* ---------- 主渲染 ---------- */

/**
 * 切项目要等 JSON 加载，所以整条渲染是异步的；用 token 丢弃过期结果，
 * 避免连续快速切换时旧数据盖掉新数据。
 */
async function render({ animate = false } = {}) {
  const token = ++renderToken;

  // 已缓存的项目不套 withLoading，否则进度条会在同一帧内闪一下。
  const cached = core.isLoaded(state.projectId);
  const loader = core.loadProject(state.projectId);
  let project;
  try {
    project = await (cached ? loader : withLoading(loader));
  } catch (error) {
    if (token === renderToken) showFatal(error);
    return;
  }
  if (token !== renderToken) return;
  current = project;

  // 新项目可能没有当前模式，退回它的第一个模式。
  if (!current.modes[state.modeId]) {
    state.modeId = Object.keys(current.modes)[0];
    writeUrl({ replace: true });
  }

  picker.setCurrent(state.projectId);
  renderProjectHead();
  renderModeSwitch();
  renderFooter();

  const g = graph();
  dom.modeSummary.textContent = g.summary ?? "";
  dom.modeSummary.hidden = state.view !== "graph" || !g.summary;

  // 讲的是节点图，切到对比 / 表格就没得讲了。
  if (state.view !== "graph" && state.tour) stopTour();

  dom.stage.hidden = state.view !== "graph";
  dom.rewards.hidden = state.view !== "graph";
  dom.compare.hidden = state.view !== "compare";
  dom.tableView.hidden = state.view !== "table";

  renderFilters();
  renderCallouts();

  if (state.view === "graph") {
    graphView.render(g, { animate, touchedIds: touchedIds(current) });
    applyFilters();
    rebuildTour();
    renderRewards({ container: dom.rewards, graph: g, taxonomy: core.taxonomy, project: current });
    if (state.tour) {
      // 讲解态接管整张图的明暗，选中与详情都让位（见 syncTourPanels）。
      syncTourPanels();
      paintTour();
    } else {
      graphView.setTour(null);
      syncTourPanels();
      syncSelection(g);
    }
  } else if (state.view === "compare") {
    await renderCompareView(token);
  } else {
    renderTable({
      container: dom.tableView,
      project: current,
      modeId: state.modeId,
      taxonomy: core.taxonomy,
    });
  }
}

async function renderCompareView(token) {
  if (!state.compareId || state.compareId === state.projectId) {
    state.compareId = defaultCompareId(state.projectId);
    writeUrl({ replace: true });
  }

  const common = {
    container: dom.compare,
    base: current,
    modeId: state.modeId,
    taxonomy: core.taxonomy,
    entries: core.entries,
    compareId: state.compareId,
    onChangeCompare: (id) => {
      state.compareId = id;
      writeUrl();
      render();
    },
  };

  if (!state.compareId) {
    renderCompare({ ...common, other: null });
    return;
  }

  if (!core.isLoaded(state.compareId)) {
    renderCompare({ ...common, other: null, loading: true });
    const other = await withLoading(core.loadProject(state.compareId)).catch(() => null);
    if (token !== renderToken) return;
    renderCompare({ ...common, other });
    return;
  }

  renderCompare({ ...common, other: await core.loadProject(state.compareId) });
}

/**
 * 把 URL / 状态里的「选中了什么」落到图与抽屉上。模块与连线互斥：换模式后另一个
 * 模式里没有这个 id 或这条边，就当没选——不能让 URL 里的旧值把抽屉钉在空内容上。
 */
function syncSelection(g) {
  const node = state.nodeId ? g.nodes.find((n) => n.id === state.nodeId) : null;
  const edge = state.edgeKey ? g.edges.find((e) => `${e.from}>${e.to}` === state.edgeKey) : null;
  state.nodeId = node?.id ?? null;
  state.edgeKey = edge ? state.edgeKey : null;
  graphView.select(node ? node.id : null);
  graphView.selectEdge(edge ? state.edgeKey : null);
  if (edge) showEdgeDetail(edge);
  else showDetail(node);
}

function closeDetail() {
  state.nodeId = null;
  state.edgeKey = null;
  graphView.select(null);
  graphView.selectEdge(null);
  showDetail(null);
  writeUrl({ replace: true });
}

/** 点开一条连线：图上只留它两端，抽屉换成这条线的详情。 */
function selectEdge(edge) {
  state.nodeId = null;
  state.edgeKey = `${edge.from}>${edge.to}`;
  graphView.selectEdge(state.edgeKey);
  showEdgeDetail(edge);
  graphView.revealSelected();
  writeUrl({ replace: true });
}

function selectNode(id) {
  const node = graph().nodes.find((n) => n.id === id);
  state.edgeKey = null;
  state.nodeId = node?.id ?? null;
  graphView.select(state.nodeId);
  showDetail(node ?? null);
  // 详情浮层刚盖住画布下半截，被点中的那个框可能正好在下面。
  graphView.revealSelected();
  writeUrl({ replace: true });
}

function showDetail(node) {
  // 窄屏上抽屉是收在屏幕底下的浮层，靠这个类推上来（样式见 style.css 的 720px 段）。
  document.body.classList.toggle("detail-open", Boolean(node));
  if (node) liftCanvasForSheet();
  renderDetail({
    emptyEl: dom.drawerEmpty,
    bodyEl: dom.drawerBody,
    node,
    taxonomy: core.taxonomy,
    graph: graph(),
    onClose: closeDetail,
    onSelectEdge: selectEdge,
  });
}

function showEdgeDetail(edge) {
  document.body.classList.toggle("detail-open", true);
  liftCanvasForSheet();
  renderEdgeDetail({
    emptyEl: dom.drawerEmpty,
    bodyEl: dom.drawerBody,
    edge,
    graph: graph(),
    taxonomy: core.taxonomy,
    onClose: closeDetail,
    onSelectNode: selectNode,
  });
}

/* ---------- 讲解 ---------- */

/**
 * 讲解是「按代码运行顺序把这张图讲一遍」：顺序由 buildTour 从图本身推出来，
 * 解说词取自节点已核对过的 desc / note / source。
 *
 * 它和详情抽屉互斥地占同一列——两块内容都在说当前这个模块，同时出现只会互相
 * 抢注意力，窄屏上还会变成两个叠在一起的浮层。
 */
function syncTourPanels() {
  const on = state.tour && state.view === "graph" && tourSteps.length > 0;
  dom.tour.hidden = !on;
  dom.drawer.hidden = on;
  document.body.classList.toggle("tour-open", on);
  dom.tourBtn.setAttribute("aria-pressed", String(on));
  dom.tourBtn.textContent = on ? "✕ 结束讲解" : "▶ 讲解";
}

function clearTourTimer() {
  if (tourTimer) clearTimeout(tourTimer);
  tourTimer = null;
}

/** 当前这一步之前（含）的全部模块：图上「已经讲亮」的那部分。 */
function visitedIds() {
  return new Set(tourSteps.slice(0, tourIndex + 1).map((step) => step.id));
}

function paintTour() {
  const step = tourSteps[tourIndex];
  if (!step) return;
  renderTour({
    container: dom.tour,
    steps: tourSteps,
    index: tourIndex,
    playing: tourPlaying,
    taxonomy: core.taxonomy,
    modeLabel: graph().label ?? state.modeId,
    onPrev: () => goTour(tourIndex - 1, { pause: true }),
    onNext: () => goTour(tourIndex + 1, { pause: true }),
    onToggle: toggleTourPlay,
    onExit: () => stopTour({ focusButton: true }),
  });
  // 顺序要紧：先把画布顶到浮层上方，reveal 才是按滚动之后的几何算的。
  liftCanvasForSheet();
  graphView.setTour({ currentId: step.id, visited: visitedIds() });
  scheduleTourStep();
}

function scheduleTourStep() {
  clearTourTimer();
  if (!tourPlaying) return;
  // 最后一步不再自动往下：讲完就停在结论上，让读者自己决定重播还是退出。
  if (tourIndex >= tourSteps.length - 1) {
    tourPlaying = false;
    paintTour();
    return;
  }
  tourTimer = setTimeout(() => goTour(tourIndex + 1), dwellFor(tourSteps[tourIndex]));
}

function goTour(index, { pause = false } = {}) {
  if (!tourSteps.length) return;
  tourIndex = Math.min(tourSteps.length - 1, Math.max(0, index));
  if (pause) tourPlaying = false;
  paintTour();
}

function toggleTourPlay() {
  // 停在最后一步时按播放 = 从头再讲一遍。
  if (!tourPlaying && tourIndex >= tourSteps.length - 1) tourIndex = 0;
  tourPlaying = !tourPlaying;
  paintTour();
}

function startTour({ index = 0, playing = true } = {}) {
  if (state.view !== "graph" || !tourSteps.length) return;
  state.tour = true;
  tourIndex = Math.min(tourSteps.length - 1, Math.max(0, index));
  tourPlaying = playing;
  // 详情与讲解同占一列，进讲解就把详情收起来。
  if (state.nodeId) {
    state.nodeId = null;
    showDetail(null);
  }
  syncTourPanels();
  writeUrl({ replace: true });
  paintTour();
}

function stopTour({ focusButton = false } = {}) {
  if (!state.tour) return;
  clearTourTimer();
  state.tour = false;
  tourPlaying = false;
  graphView.setTour(null);
  syncTourPanels();
  clear(dom.tour);
  writeUrl({ replace: true });
  // 只有读者自己退出时才把焦点还给按钮；切视图导致的自动退出不该抢焦点。
  if (focusButton) dom.tourBtn.focus();
}

/** 讲解态下点图上的模块 = 跳到讲它的那一步（并停下来，读者已经接管了）。 */
function jumpTourTo(nodeId) {
  const index = tourSteps.findIndex((step) => step.id === nodeId);
  if (index >= 0) goTour(index, { pause: true });
}

/** 换项目 / 换模式后重建步骤表：同名模块还在就停在原处，不在就从头讲。 */
function rebuildTour() {
  clearTourTimer();
  if (state.view !== "graph") {
    tourSteps = [];
    if (state.tour) stopTour();
    return;
  }
  const previousId = tourSteps[tourIndex]?.id ?? null;
  tourSteps = buildTour(graph()).steps;
  const same = previousId ? tourSteps.findIndex((step) => step.id === previousId) : -1;
  tourIndex = same >= 0 ? same : 0;
  if (!tourSteps.length && state.tour) stopTour();
}

/* ---------- 状态变更 ---------- */

function setProject(id) {
  if (id === state.projectId) return;
  state.projectId = id;
  state.nodeId = null;
  state.edgeKey = null;
  if (state.compareId === id) state.compareId = defaultCompareId(id);
  writeUrl();
  render();
}

function stepProject(delta) {
  const index = core.entries.findIndex((entry) => entry.id === state.projectId);
  if (index < 0) return;
  const next = core.entries[(index + delta + core.entries.length) % core.entries.length];
  setProject(next.id);
}

function setMode(modeId) {
  // 键盘快捷键可能请求当前项目没有的模式。
  if (modeId === state.modeId || !current?.modes[modeId]) return;
  state.modeId = modeId;
  // 同 id 的模块在两个模式里指同一件事，保留选中项让读者看清它怎么变。
  if (state.nodeId && !current.modes[modeId].nodes.some((n) => n.id === state.nodeId)) {
    state.nodeId = null;
  }
  // 连线同理：两个模式里的同一条边说的是同一件事，另一个模式没有它才丢掉。
  if (state.edgeKey && !current.modes[modeId].edges.some((e) => `${e.from}>${e.to}` === state.edgeKey)) {
    state.edgeKey = null;
  }
  writeUrl();
  render({ animate: state.view === "graph" });
}

function setView(view) {
  if (view === state.view) return;
  state.view = view;
  writeUrl();
  render();
}

/* ---------- 视口适配 ---------- */

/**
 * 把顶栏与工具栏的实测高度写进 CSS 变量。粘性定位的偏移量原先是写死的 53 / 104，
 * 顶栏一换行（窄屏、长项目名、系统字体放大）下面的东西就会被压在它底下。
 */
function syncStickyMetrics() {
  const root = document.documentElement.style;
  root.setProperty("--header-h", `${Math.round(dom.header.offsetHeight)}px`);
  root.setProperty("--toolbar-h", `${Math.round(dom.toolbar.offsetHeight)}px`);
}

/**
 * 详情浮层升起时把画布顶到顶栏底下。浮层占掉屏幕下半截，画布留在原位的话
 * 只剩几十像素露在外面，读者就看不见自己点的是图上的哪一格了。
 * 只往下滚：读者已经翻到更下面时不该被拽回来。
 */
function liftCanvasForSheet() {
  if (state.view !== "graph") return;
  const sheet = state.tour ? dom.tour : dom.drawer;
  if (sheet.hidden) return;
  if (getComputedStyle(sheet).position !== "fixed") return;
  const top =
    dom.canvas.getBoundingClientRect().top + window.scrollY - dom.header.offsetHeight - 6;
  if (window.scrollY < top - 4) window.scrollTo(0, top);
}

/** 触屏没有滚轮，也没有「点击」这个说法，提示语要按输入方式换。 */
function setupCanvasHint() {
  // 认 pointer 而不是 hover：无鼠标的桌面浏览器也会报 hover: none，但它不是手指。
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  dom.canvasHint.textContent = coarse
    ? "拖动平移 · 双指缩放 · 点按模块或连线看详情"
    : "滚轮缩放 · 拖拽平移 · 点击模块或连线看详情";

  const fade = () => dom.canvasHint.classList.add("faded");
  dom.canvas.addEventListener("pointerdown", fade, { once: true });
  dom.canvas.addEventListener("wheel", fade, { once: true, passive: true });
}

function showFatal(error) {
  document.body.append(
    el("div", { style: { padding: "24px", color: "#ff8a7a" } }, [
      el("h2", { text: "加载失败" }),
      el("p", { text: String(error) }),
      el("p", {
        text: "本页需要通过 HTTP 打开（data/*.json 用 fetch 加载），直接双击本地文件会被浏览器拦截。",
      }),
    ])
  );
  console.error(error);
}

/* ---------- 启动 ---------- */

async function boot() {
  core = await withLoading(loadCore());

  const url = readUrl();
  state.projectId =
    (url.projectId && core.entryById.has(url.projectId) && url.projectId) ||
    core.registry.defaultProject ||
    core.entries[0].id;
  state.modeId = url.modeId || core.registry.defaultMode || "train";
  state.view = VIEWS.some((v) => v.id === url.view) ? url.view : "graph";
  state.nodeId = url.nodeId;
  state.edgeKey = url.edgeKey;
  state.tour = Boolean(url.tour) && state.view === "graph";
  state.compareId =
    url.compareId && core.entryById.has(url.compareId) && url.compareId !== state.projectId
      ? url.compareId
      : defaultCompareId(state.projectId);

  picker = createProjectPicker({
    trigger: dom.pickerTrigger,
    currentLabel: dom.pickerCurrent,
    panel: dom.pickerPanel,
    search: dom.pickerSearch,
    list: dom.pickerList,
    empty: dom.pickerEmpty,
    entries: core.entries,
    groups: core.groups,
    onPick: setProject,
  });
  picker.setCurrent(state.projectId);

  graphView = createGraphView({
    canvas: dom.canvas,
    viewport: dom.viewport,
    svg: dom.edges,
    nodesLayer: dom.nodes,
    taxonomy: core.taxonomy,
    // 窄屏上这两块都是贴底浮层，画布要知道自己被挡掉了多少。
    overlays: [dom.drawer, dom.tour],
    onTourJump: jumpTourTo,
    // 图上点中的和抽屉里点中的走同一条路：再点一次是取消选中，那就等于关掉详情。
    onSelect: (node) => (node ? selectNode(node.id) : closeDetail()),
    onSelectEdge: (edge) => (edge ? selectEdge(edge) : closeDetail()),
  });

  setFlow(initialFlow(), { persist: false });

  renderLegend();
  const wantTour = state.tour;
  state.tour = false; // 先按常规渲染一遍，把步骤表建出来再进讲解
  await render();
  // 分享链接带 tour=1 时不自动播放：读者刚落地，先让他看清整张图。
  if (wantTour) startTour({ playing: false });
  writeUrl({ replace: true });

  syncStickyMetrics();
  new ResizeObserver(syncStickyMetrics).observe(dom.header);
  new ResizeObserver(syncStickyMetrics).observe(dom.toolbar);
  setupCanvasHint();

  dom.tourBtn.addEventListener("click", () =>
    state.tour ? stopTour({ focusButton: true }) : startTour()
  );
  dom.fitBtn.addEventListener("click", () => graphView.fit());
  dom.flowBtn.addEventListener("click", () => setFlow(!state.flow));
  dom.zoomIn.addEventListener("click", () => graphView.zoomBy(1.25));
  dom.zoomOut.addEventListener("click", () => graphView.zoomBy(1 / 1.25));
  dom.zoomFit.addEventListener("click", () => graphView.fit());
  dom.legendBtn.addEventListener("click", () => {
    const open = dom.legend.hidden;
    dom.legend.hidden = !open;
    dom.legendBtn.setAttribute("aria-expanded", String(open));
    dom.legendBtn.setAttribute("aria-pressed", String(open));
  });

  dom.themeBtn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("riob-theme", next);
    } catch {
      /* 隐私模式下写不进去也无所谓 */
    }
  });

  window.addEventListener("popstate", () => {
    const next = readUrl();
    if (next.projectId && core.entryById.has(next.projectId)) state.projectId = next.projectId;
    if (next.modeId) state.modeId = next.modeId;
    state.view = VIEWS.some((v) => v.id === next.view) ? next.view : "graph";
    state.nodeId = next.nodeId;
    state.edgeKey = next.edgeKey;
    state.tour = Boolean(next.tour) && state.view === "graph";
    state.compareId =
      next.compareId && core.entryById.has(next.compareId) ? next.compareId : state.compareId;
    render();
  });

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement) return;
    if (event.target instanceof HTMLSelectElement) return;
    if (picker.isOpen && event.key !== "Escape") return;

    const key = event.key.toLowerCase();

    // 讲解态先接管自己的几个键：空格播放/暂停、左右翻步、Esc 退出。
    if (state.tour) {
      // 焦点在讲解按钮上时空格归按钮自己，否则一下会既按按钮又切播放。
      const onControl = event.target instanceof HTMLButtonElement;
      if (!onControl && (event.key === " " || event.key === "Spacebar")) {
        event.preventDefault();
        toggleTourPlay();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goTour(tourIndex + 1, { pause: true });
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTour(tourIndex - 1, { pause: true });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        stopTour({ focusButton: true });
        return;
      }
    }

    if (key === "g") {
      event.preventDefault();
      if (state.tour) stopTour({ focusButton: true });
      else startTour();
    } else if (key === "p" || event.key === "/") {
      event.preventDefault();
      picker.open();
    } else if (event.key === "[") stepProject(-1);
    else if (event.key === "]") stepProject(1);
    // T / D 按「第一个 / 第二个模式」解释，而不是写死 train / deploy——
    // 不以真机为目标的项目第二个模式叫「推理态」（test），写死会让 D 在这些项目上失灵。
    else if (key === "t") setMode(modeIdAt(0));
    else if (key === "d") setMode(modeIdAt(1));
    else if (key === "f") graphView.fit();
    else if (key === "l") setFlow(!state.flow);
    else if (event.key === "Escape" && (state.nodeId || state.edgeKey)) closeDetail();
  });
}

boot().catch(showFatal);
