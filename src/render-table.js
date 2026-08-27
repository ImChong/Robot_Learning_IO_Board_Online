/** 表格视图：与节点图同数据的无障碍 / 打印 / 无 JS 降级形态。 */

import { el, clear, queueMath } from "./dom.js";
import { exprTex, noiseTex, numberTex } from "./mathtext.js";

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

  // 窄屏才显示（样式里控制）：手机上没有滚动条，横向还有内容这件事看不出来。
  container.append(
    el("p", { class: "table-scroll-hint", text: "表格比屏幕宽，左右滑动可以看到余下的列。" })
  );

  container.append(nodeTable(graph, taxonomy));
  if (graph.rewards?.length) container.append(rewardTable(graph, taxonomy));
}

function nodeTable(graph, taxonomy) {
  const head = el("thead", {}, [
    el(
      "tr",
      {},
      ["泳道", "模块", "类别", "维度", "维度构成", "分量顺序", "获取方式", "部署可得性", "训练噪声", "可信度", "出处"].map(
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
          mathCell(node.dimExpr, exprTex(node.dimExpr)),
          el("td", { class: "tv-layout", text: node.dimLayout ?? "—" }),
          el("td", { text: acq && acq.id !== "none" ? acq.name : "—" }),
          el("td", { text: avail && avail.id !== "n/a" ? avail.name : "—" }),
          mathCell(node.noise, noiseTex(node.noise)),
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
      body.append(
        el("tr", {}, [
          el("td", { text: `${group.id} · ${group.name}` }),
          el("td", {}, [el("div", { text: reward.label }), el("code", { text: reward.id })]),
          weightCell(reward.weight),
          formulaCell(reward.form),
          paramsCell(reward.params),
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

/**
 * 「形式」列。form 存的是 LaTeX 源码，直接当文本摆出来就是一串反斜杠，
 * 所以和奖励面板走同一套 KaTeX；holder 单独一层是因为公式可能比列宽长，
 * 让它自己横滑，别把整张表撑宽。
 */
function formulaCell(tex) {
  if (!tex) return el("td", { class: "mono", text: "—" });
  const holder = el("div", { class: "tv-formula" });
  queueMath(holder, tex);
  return el("td", {}, [holder]);
}

/**
 * 「维度构成」「训练噪声」这类格子：数据里存的是给人读的文本而不是 TeX，
 * 由 mathtext.js 翻一道。翻不动（一句说明文字、没见过的写法）就按原文摆等宽，
 * 少排一格比排错一格好。
 */
function mathCell(text, tex) {
  if (!text) return el("td", { class: "mono", text: "—" });
  if (!tex) return el("td", { class: "mono", text });
  const holder = el("div", { class: "tv-formula" });
  queueMath(holder, tex, text);
  return el("td", {}, [holder]);
}

/** 「权重」列。跨了六个数量级，小到 -2.5e-6 的那档要排成科学计数法才读得出来。 */
function weightCell(weight) {
  const tex = numberTex(weight);
  if (!tex) return el("td", { class: "num", text: String(weight) });
  const cell = el("td", { class: "num" });
  queueMath(cell, tex, String(weight));
  return cell;
}

// 配置键在源码里就写作 disc_reward_weight，排成公式反而认不出来了，保持等宽。
const CONFIG_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

/** 「参数」列。σ = 0.3 这类数学符号排成公式，配置键仍按代码摆。 */
function paramsCell(params) {
  const entries = Object.entries(params ?? {});
  if (!entries.length) return el("td", { class: "mono", text: "—" });

  const cell = el("td", { class: "tv-params" });
  for (const [i, [key, value]] of entries.entries()) {
    if (i) cell.append("，");
    const text = `${key} = ${value}`;
    const tex = CONFIG_KEY.test(key) ? null : exprTex(text);
    if (!tex) {
      cell.append(el("code", { text }));
      continue;
    }
    const holder = el("span", { class: "tv-inline" });
    queueMath(holder, tex, text);
    cell.append(holder);
  }
  return cell;
}

function sourceText(source) {
  if (!source) return "—";
  return [source.path, source.symbol].filter(Boolean).join(" › ");
}
