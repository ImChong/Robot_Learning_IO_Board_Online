/** 表格视图：与节点图同数据的无障碍 / 打印 / 无 JS 降级形态。 */

import { el, clear } from "./dom.js";

export function renderTable({ container, project, modeId, taxonomy }) {
  clear(container);
  const graph = project.modes[modeId];

  container.append(
    el("div", { class: "section-head" }, [
      el("h2", { text: `${project.name} · ${graph.label} 数据表` }),
      el("p", {
        text: "节点图的同数据表格形态，便于筛查、复制与打印。列的含义与图上的视觉编码一一对应。",
      }),
    ])
  );

  container.append(nodeTable(graph, taxonomy));
  if (graph.rewards?.length) container.append(rewardTable(graph, taxonomy));
}

function nodeTable(graph, taxonomy) {
  const head = el("thead", {}, [
    el(
      "tr",
      {},
      ["泳道", "模块", "类别", "维度", "维度构成", "获取方式", "部署可得性", "训练噪声", "可信度", "出处"].map(
        (text) => el("th", { scope: "col", text })
      )
    ),
  ]);

  const body = el("tbody");
  for (const laneId of graph.lanes) {
    const lane = taxonomy.laneById.get(laneId);
    for (const node of graph.nodes.filter((n) => n.lane === laneId)) {
      const cls = node.class ? taxonomy.classById.get(node.class) : null;
      const acq = node.acquisition ? taxonomy.acquisitionById.get(node.acquisition) : null;
      const avail = node.availability ? taxonomy.availabilityById.get(node.availability) : null;
      const conf = taxonomy.confidenceById.get(node.confidence);
      body.append(
        el("tr", {}, [
          el("td", { text: lane?.name ?? laneId }),
          el("td", {}, [
            el("div", { text: node.label }),
            node.sub ? el("code", { text: node.sub }) : null,
          ]),
          el("td", { text: cls ? `${cls.id} · ${cls.name}` : "—" }),
          el("td", { class: "num", text: node.dim != null ? String(node.dim) : "—" }),
          el("td", { class: "mono", text: node.dimExpr ?? "—" }),
          el("td", { text: acq && acq.id !== "none" ? acq.name : "—" }),
          el("td", { text: avail && avail.id !== "n/a" ? avail.name : "—" }),
          el("td", { class: "mono", text: node.noise ?? "—" }),
          el("td", { text: conf?.name ?? "—" }),
          el("td", { class: "mono", text: node.source ? sourceText(node.source) : "—" }),
        ])
      );
    }
  }

  return el("div", { class: "tv-wrap" }, [
    el("table", { class: "tv" }, [
      el("caption", { text: `模块清单 · ${graph.nodes.length} 项` }),
      head,
      body,
    ]),
  ]);
}

function rewardTable(graph, taxonomy) {
  const head = el("thead", {}, [
    el(
      "tr",
      {},
      ["分类", "奖励项", "权重", "形式", "参数", "作用对象", "出处"].map((text) =>
        el("th", { scope: "col", text })
      )
    ),
  ]);

  const body = el("tbody");
  for (const group of taxonomy.rewardGroups) {
    for (const reward of graph.rewards.filter((r) => r.group === group.id)) {
      const params = Object.entries(reward.params ?? {})
        .map(([k, v]) => `${k} = ${v}`)
        .join("，");
      body.append(
        el("tr", {}, [
          el("td", { text: `${group.id} · ${group.name}` }),
          el("td", {}, [el("div", { text: reward.label }), el("code", { text: reward.id })]),
          el("td", { class: "num", text: String(reward.weight) }),
          el("td", { class: "mono", text: reward.form ?? "—" }),
          el("td", { class: "mono", text: params || "—" }),
          el("td", { text: reward.target ?? "—" }),
          el("td", { class: "mono", text: sourceText(reward.source) }),
        ])
      );
    }
  }

  return el("div", { class: "tv-wrap" }, [
    el("table", { class: "tv" }, [
      el("caption", { text: `奖励项 · ${graph.rewards.length} 项` }),
      head,
      body,
    ]),
  ]);
}

function sourceText(source) {
  if (!source) return "—";
  return [source.path, source.symbol].filter(Boolean).join(" › ");
}
