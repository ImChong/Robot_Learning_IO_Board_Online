/** 详情抽屉：模块的维度构成、真机如何获得、出处。 */

import { el, clear } from "./dom.js";
import { nodeColor } from "./data.js";

const REPO_URLS = {
  whole_body_tracking: "https://github.com/HybridRobotics/whole_body_tracking",
  "GR00T-WholeBodyControl": "https://github.com/NVlabs/GR00T-WholeBodyControl",
  MimicKit: "https://github.com/xbpeng/MimicKit",
};

export function renderDetail({ emptyEl, bodyEl, node, taxonomy, graph, onClose, onSelectEdge }) {
  if (!node) {
    emptyEl.hidden = false;
    bodyEl.hidden = true;
    clear(bodyEl);
    return;
  }

  emptyEl.hidden = true;
  bodyEl.hidden = false;
  clear(bodyEl);

  const cls = node.class ? taxonomy.classById.get(node.class) : null;
  const acq = node.acquisition ? taxonomy.acquisitionById.get(node.acquisition) : null;
  const avail = node.availability ? taxonomy.availabilityById.get(node.availability) : null;
  const conf = taxonomy.confidenceById.get(node.confidence);
  const kindName = taxonomy.nodeKinds.find((k) => k.id === node.kind)?.name;

  bodyEl.append(
    el("div", { class: "dd-head" }, [
      el("h2", { text: node.label }),
      el("button", {
        class: "dd-close",
        type: "button",
        "aria-label": "关闭详情",
        text: "✕",
        onClick: onClose,
      }),
    ])
  );

  if (node.sub) bodyEl.append(el("p", { class: "dd-sub", text: node.sub }));

  const badges = el("div", { class: "dd-badges" }, [
    cls
      ? el("span", {
          class: "badge strong",
          style: { background: cls.color },
          text: `${cls.id} · ${cls.name}`,
          title: cls.desc,
        })
      : el("span", { class: "badge", text: kindName ?? node.kind }),
    avail && avail.id !== "n/a"
      ? el("span", {
          class: avail.id === "deploy-ok" ? "badge" : "badge warn",
          text: avail.name,
          title: avail.desc,
        })
      : null,
    conf && conf.id !== "verified"
      ? el("span", { class: "badge warn", text: conf.name, title: conf.desc })
      : conf
      ? el("span", { class: "badge", text: conf.name, title: conf.desc })
      : null,
    node.freqHz ? el("span", { class: "badge", text: `${node.freqHz} Hz` }) : null,
  ]);
  bodyEl.append(badges);

  if (node.dim != null) {
    bodyEl.append(
      el("div", { class: "dd-dim", style: { borderLeft: `3px solid ${nodeColor(node, taxonomy)}` } }, [
        el("div", { class: "dd-dim-val", text: `${node.dim} 维` }),
        node.dimExpr ? el("div", { class: "dd-dim-expr", text: node.dimExpr }) : null,
        node.dimLayout ? el("div", { class: "dd-dim-layout", text: node.dimLayout }) : null,
      ])
    );
  }

  if (node.desc) {
    bodyEl.append(el("div", { class: "dd-section" }, [el("p", { text: node.desc })]));
  }

  const kv = [];
  if (acq && acq.id !== "none") kv.push(["真机如何获得", `${acq.icon} ${acq.name}`]);
  if (node.unit) kv.push(["单位", node.unit]);
  if (node.noise) kv.push(["训练噪声", node.noise]);
  if (kv.length) {
    const dl = el("dl", { class: "dd-kv" });
    for (const [key, value] of kv) {
      dl.append(el("dt", { text: key }), el("dd", { text: value }));
    }
    bodyEl.append(el("div", { class: "dd-section" }, [el("h3", { text: "获取与量纲" }), dl]));
  }

  if (acq && acq.id !== "none" && acq.desc) {
    bodyEl.append(
      el("div", { class: "dd-section" }, [el("h3", { text: acq.name }), el("p", { text: acq.desc })])
    );
  }

  if (node.note) {
    bodyEl.append(el("div", { class: "dd-section note" }, [el("p", { text: node.note })]));
  }

  const links = connections(node, graph, taxonomy, onSelectEdge);
  if (links) bodyEl.append(links);

  if (node.source) {
    const link = sourceLink(node.source);
    bodyEl.append(
      el("div", { class: "dd-section" }, [
        el("h3", { text: "出处" }),
        el("div", { class: "dd-links" }, [
          link
            ? el("a", { href: link, target: "_blank", rel: "noopener", text: node.source.path })
            : el("code", { text: node.source.path }),
          node.source.symbol ? el("code", { text: node.source.symbol }) : null,
        ]),
      ])
    );
  } else if (node.dim != null) {
    bodyEl.append(
      el("div", { class: "dd-section" }, [
        el("h3", { text: "出处" }),
        el("p", { text: "与本项目另一模式下的同名模块同源，出处见该模块。" }),
      ])
    );
  }
}

/**
 * 「连线」一节：这个模块的入边与出边，每条都能点开看那条线本身。
 *
 * 它同时是连线详情的键盘入口——图上的连线只有鼠标和手指点得到（SVG 整块是
 * aria-hidden 的，往里塞几十个可聚焦元素只会把 Tab 键淹掉），从这里进去，
 * 用键盘的读者一样能看到每条线的信息。
 */
function connections(node, graph, taxonomy, onSelectEdge) {
  if (!graph || !onSelectEdge) return null;
  const labelOf = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const rows = [
    ["上游给它", graph.edges.filter((e) => e.to === node.id), "←", (e) => e.from],
    ["它交给下游", graph.edges.filter((e) => e.from === node.id), "→", (e) => e.to],
  ].filter(([, list]) => list.length);
  if (!rows.length) return null;

  return el("div", { class: "dd-section" }, [
    el("h3", { text: "连线" }),
    ...rows.map(([title, list, arrow, other]) =>
      el("div", { class: "dd-flow-row" }, [
        el("span", { class: "dd-flow-key", text: title }),
        el(
          "span",
          { class: "dd-flow-items" },
          list.map((edge) => {
            const kind = taxonomy.edgeKindById.get(edge.kind);
            return el(
              "button",
              {
                class: "dd-edge",
                type: "button",
                style: { "--edge-color": kind?.color ?? "#7d8794" },
                title: `${kind?.name ?? edge.kind}：点开看这条连线`,
                onClick: () => onSelectEdge(edge),
              },
              [
                el("span", { class: "dd-edge-arrow", "aria-hidden": "true", text: arrow }),
                el("span", { class: "dd-edge-name", text: labelOf.get(other(edge)) ?? other(edge) }),
                edge.label ? el("span", { class: "dd-edge-tag", text: edge.label }) : null,
              ]
            );
          })
        ),
      ])
    ),
  ]);
}

/**
 * 连线详情：这条线从哪到哪、搬的是什么、属于哪一类流、部署时还在不在。
 *
 * 边本身在数据里只有 from / to / kind / style / label 五个字段，所以这里说的话
 * 大半是推出来的——搬的东西就是起点模块的那个向量，方向由两端所在的列决定，
 * 部署时在不在由两端的可得性决定。推得出来就不必往数据里再抄一份。
 */
export function renderEdgeDetail({
  emptyEl,
  bodyEl,
  edge,
  graph,
  taxonomy,
  onClose,
  onSelectNode,
}) {
  emptyEl.hidden = true;
  bodyEl.hidden = false;
  clear(bodyEl);

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);
  const kind = taxonomy.edgeKindById.get(edge.kind);
  const color = kind?.color ?? "#7d8794";
  const laneAt = (n) => graph.lanes.indexOf(n?.lane);
  const back = laneAt(from) > laneAt(to);
  const sameLane = laneAt(from) === laneAt(to);
  const trainOnly = [from, to].some((n) => n?.availability === "train-only");

  bodyEl.append(
    el("div", { class: "dd-head" }, [
      el("h2", { class: "dd-edge-title" }, [
        el("span", { text: from?.label ?? edge.from }),
        el("span", { class: "dd-edge-to", "aria-label": "流向", text: "→" }),
        el("span", { text: to?.label ?? edge.to }),
      ]),
      el("button", {
        class: "dd-close",
        type: "button",
        "aria-label": "关闭详情",
        text: "✕",
        onClick: onClose,
      }),
    ]),

    el("div", { class: "dd-badges" }, [
      el("span", { class: "badge strong", style: { background: color }, text: kind?.name ?? edge.kind }),
      from?.dim != null ? el("span", { class: "badge", text: `搬 ${from.dim} 维` }) : null,
      trainOnly ? el("span", { class: "badge warn", text: "部署时消失" }) : null,
      edge.style === "dashed" ? el("span", { class: "badge", text: "虚线", title: "仅训练期存在，或搬的是信息而不是每拍都走的数据" }) : null,
    ])
  );

  if (kind?.desc) {
    bodyEl.append(el("div", { class: "dd-section" }, [el("p", { text: kind.desc })]));
  }

  const kv = [];
  if (edge.label) kv.push(["线上标注", edge.label]);
  kv.push([
    "走向",
    back
      ? "回路：绕到图上下方的通道里走回去，下一拍才用到"
      : sameLane ? "同一列内部：从左侧出、左侧入，向左鼓一个小弧" : "前向：往右一列送",
  ]);
  if (from?.dim != null) {
    kv.push(["搬的是什么", from.dimLayout ? `${from.label}（${from.dim} 维，${from.dimLayout}）` : `${from.label}（${from.dim} 维）`]);
  }
  const dl = el("dl", { class: "dd-kv prose" });
  for (const [key, value] of kv) dl.append(el("dt", { text: key }), el("dd", { text: value }));
  bodyEl.append(el("div", { class: "dd-section" }, [dl]));

  bodyEl.append(
    el("div", { class: "dd-section" }, [
      el("h3", { text: "两端" }),
      el("div", { class: "dd-flow-items" }, [
        endpointButton(from, edge.from, "起点", onSelectNode, taxonomy),
        endpointButton(to, edge.to, "终点", onSelectNode, taxonomy),
      ]),
    ])
  );
}

function endpointButton(node, id, role, onSelectNode, taxonomy) {
  const cls = node?.class ? taxonomy.classById.get(node.class) : null;
  return el(
    "button",
    {
      class: "dd-edge",
      type: "button",
      style: { "--edge-color": cls?.color ?? "#7d8794" },
      title: "打开这个模块的详情",
      onClick: () => onSelectNode(id),
    },
    // 两端不画箭头：起点 / 终点已经把方向说清楚了，再来一个箭头只会跟标题里的那个打架。
    [el("span", { class: "dd-edge-name", text: node?.label ?? id }), el("span", { class: "dd-edge-tag", text: role })]
  );
}

/** 把 source.path 拼成可点的仓库链接；带省略号的路径无法定位，就只显示文本。 */
export function sourceLink(source) {
  const base = REPO_URLS[source.repo];
  if (!base) return null;
  if (!source.path || source.path.includes("...")) return base;
  if (source.path.startsWith("http")) return source.path;
  if (source.path.includes("huggingface.co")) return `https://${source.path}`;
  return `${base}/blob/main/${source.path}`;
}
