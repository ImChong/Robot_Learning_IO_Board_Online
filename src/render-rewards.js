/** 奖励面板：按六类折叠，权重用对数刻度条，公式走 KaTeX。 */

import { el, clear, renderMath } from "./dom.js";

const LOG_MIN = -7; // 10^-7，覆盖 feet_acc 的 -2.5e-6 这类极小权重
const LOG_MAX = 1; // 10^1，覆盖 joint_limit 的 -10

const pendingFormulas = new Set();

function barWidth(weight) {
  const mag = Math.log10(Math.abs(weight));
  const t = (Math.min(LOG_MAX, Math.max(LOG_MIN, mag)) - LOG_MIN) / (LOG_MAX - LOG_MIN);
  return `${(4 + t * 96).toFixed(1)}%`;
}

function formatWeight(weight) {
  const abs = Math.abs(weight);
  if (abs === 0) return "0";
  if (abs >= 0.01) return String(weight);
  return weight.toExponential(1).replace("e-", "e−");
}

export function renderRewards({ container, graph, taxonomy, project }) {
  clear(container);
  pendingFormulas.clear();

  const rewards = graph.rewards ?? [];
  if (!rewards.length) {
    container.append(
      el("div", { class: "section-head" }, [
        el("h2", { text: "奖励函数" }),
        el("p", {
          text:
            "部署态没有奖励函数。奖励只在训练期活着——真机上环境不再给分，六类奖励的偏好已经烧进了网络权重。",
        }),
      ])
    );
    return;
  }

  const positive = rewards.filter((r) => r.weight > 0).reduce((sum, r) => sum + r.weight, 0);
  container.append(
    el("div", { class: "section-head" }, [
      el("h2", { text: `奖励函数 · ${rewards.length} 项` }),
      el("p", {
        text: `${project.name} 训练期的全部奖励项，按「替谁说话」分六类。正向权重合计 ${positive.toFixed(
          1
        )}，总奖励是加权和 r = Σ wᵢ rᵢ。`,
      }),
    ])
  );

  const groups = el("div", { class: "reward-groups" });
  for (const group of taxonomy.rewardGroups) {
    const items = rewards.filter((r) => r.group === group.id);
    if (!items.length) continue;
    groups.append(buildGroup(group, items, project));
  }
  container.append(groups);

  container.append(
    el("p", {
      class: "reward-scale-note",
      text:
        "权重条用对数刻度（10⁻⁷ ~ 10¹）——各项权重跨了七个数量级，线性刻度下小权重会完全看不见。绿色向右为正向奖励，红色向左为惩罚。",
    })
  );

  flushFormulas();
}

function buildGroup(group, items, project) {
  const details = el(
    "details",
    { class: "reward-group", open: true, style: { "--group-color": group.color } },
    [
      el("summary", {}, [
        el("span", { class: "rg-code", text: group.id }),
        el("span", { text: group.name }),
        el("span", { class: "rg-count", text: `${items.length} 项` }),
        el("span", { class: "rg-desc", text: group.desc }),
      ]),
    ]
  );

  const list = el("div", { class: "reward-list" });
  for (const reward of items) list.append(buildItem(reward, group, project));
  details.append(list);
  return details;
}

function buildItem(reward, group, project) {
  const positive = reward.weight > 0;
  const bar = el("div", { class: "ri-bar" }, [
    el("span", {
      style: {
        width: barWidth(reward.weight),
        background: positive ? "#3ddc97" : "#ff8a7a",
        [positive ? "left" : "right"]: "0",
      },
    }),
  ]);

  const meta = [];
  if (reward.target) meta.push(`作用于 ${reward.target}`);
  for (const [key, value] of Object.entries(reward.params ?? {})) {
    meta.push(`${key} = ${value}`);
  }
  if (reward.source?.symbol) meta.push(reward.source.symbol);

  const body = el("div", { class: "ri-body" });
  if (reward.form) {
    const holder = el("div", { class: "ri-formula" });
    pendingFormulas.add([holder, reward.form]);
    body.append(holder);
  }
  if (reward.desc) body.append(el("p", { text: reward.desc }));
  if (meta.length) {
    body.append(
      el(
        "div",
        { class: "ri-meta" },
        meta.map((text) => el("code", { text }))
      )
    );
  }
  if (reward.note) body.append(el("p", { class: "ri-note", text: reward.note }));

  return el("div", { class: "reward-item", dataset: { id: reward.id } }, [
    el("div", {}, [
      el("div", { class: "ri-name", text: reward.label }),
      el("div", { class: "ri-id", text: reward.id }),
      reward.sharedWith
        ? el("span", {
            class: "ri-shared",
            text: `与 ${reward.sharedWith} 同权重`,
            title: "两个项目里同名、同权重、同参数",
          })
        : null,
    ]),
    el("div", { class: "ri-weight" }, [
      el("div", {
        class: `ri-weight-val ${positive ? "pos" : "neg"}`,
        text: formatWeight(reward.weight),
      }),
      bar,
    ]),
    body,
  ]);
}

/** KaTeX 可能还没加载完，先记账，等 load 之后统一补渲染。 */
function flushFormulas() {
  let allDone = true;
  for (const entry of pendingFormulas) {
    const [holder, tex] = entry;
    if (renderMath(holder, tex)) pendingFormulas.delete(entry);
    else allDone = false;
  }
  if (!allDone && !flushFormulas.scheduled) {
    flushFormulas.scheduled = true;
    window.addEventListener("load", () => {
      flushFormulas.scheduled = false;
      flushFormulas();
    });
  }
}
