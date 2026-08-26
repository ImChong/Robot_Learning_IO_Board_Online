/** 奖励面板：按六类折叠，权重用对数刻度条，公式走 KaTeX。 */

import { el, clear, renderMath } from "./dom.js";

// 权重条的对数定义域。取 10^-4 ~ 10^1：上界覆盖 joint_limit 的 -10，
// 下界不取更小是因为跨度一拉大，0.5 与 1.0 这类常用权重就几乎一样长了；
// 比 10^-4 更小的权重（如 feet_acc 的 -2.5e-6）夹到最短，读作「基本可忽略」。
const LOG_MIN = -4;
const LOG_MAX = 1;

const pendingFormulas = new Set();

function barWidth(weight) {
  const mag = Math.log10(Math.abs(weight));
  const t = (Math.min(LOG_MAX, Math.max(LOG_MIN, mag)) - LOG_MIN) / (LOG_MAX - LOG_MIN);
  return `${(3 + t * 97).toFixed(1)}%`;
}

function formatWeight(weight) {
  const abs = Math.abs(weight);
  if (abs === 0) return "0";
  if (abs >= 0.01) return String(weight);
  return weight.toExponential(1).replace("e-", "e−");
}

const kindOf = (reward) => reward.rewardKind ?? "handcrafted";
const isLearned = (reward) => LEARNED_LABEL[kindOf(reward)] != null;

const LEARNED_LABEL = {
  adversarial: "对抗 · 判别器",
  encoder: "编码器 · 互信息",
  generative: "生成式 · 冻结先验",
};

export function renderRewards({ container, graph, taxonomy, project }) {
  clear(container);
  pendingFormulas.clear();

  const rewards = graph.rewards ?? [];
  if (!rewards.length) {
    container.append(
      el("div", { class: "section-head" }, [
        el("h2", { text: "奖励函数" }),
        el("p", {
          text: `${
            graph.label ?? "这个模式"
          }没有奖励函数。奖励只在训练期活着——环境不再给分，六类奖励的偏好已经烧进了网络权重。`,
        }),
      ])
    );
    return;
  }

  const positive = rewards.filter((r) => r.weight > 0).reduce((sum, r) => sum + r.weight, 0);
  const learned = rewards.filter(isLearned);
  const intro =
    `${project.name} 训练期的全部奖励项，按「替谁说话」分六类。正向权重合计 ${positive.toFixed(1)}，` +
    `总奖励是加权和 r = Σ wᵢ rᵢ。`;
  const learnedNote = learned.length
    ? `其中 ${learned.length} 项不是手写公式，而是网络算出来的——这类项没有可以逐条列出的分项权重，` +
      `weight 是它在总奖励里的混合系数，真正的信息在「吃什么 · 正样本 · 怎么变成标量」这三行里。`
    : "";

  container.append(
    el("div", { class: "section-head" }, [
      el("h2", { text: `奖励函数 · ${rewards.length} 项` }),
      el("p", { text: intro }),
      learnedNote ? el("p", { class: "sh-learned", text: learnedNote }) : null,
    ])
  );

  const groups = el("div", { class: "reward-groups" });
  for (const group of taxonomy.rewardGroups) {
    const items = rewards.filter((r) => r.group === group.id);
    if (!items.length) continue;
    // 手写与任务项在上，学习式的在下：前者能比权重，后者只能比结构。
    items.sort((a, b) => Number(isLearned(a)) - Number(isLearned(b)));
    groups.append(buildGroup(group, items, project));
  }
  container.append(groups);

  container.append(
    el("p", {
      class: "reward-scale-note",
      text:
        "权重条用对数刻度（10⁻⁴ ~ 10¹）：各项权重跨了好几个数量级，线性刻度下小权重会完全看不见。绿色向右为正向奖励，红色向左为惩罚；比 10⁻⁴ 更小的权重夹到最短一格。",
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
  if (reward.model) body.append(buildModelCard(reward));
  if (reward.note) body.append(el("p", { class: "ri-note", text: reward.note }));

  const learned = isLearned(reward);
  return el(
    "div",
    { class: `reward-item${learned ? " learned" : ""}`, dataset: { id: reward.id } },
    [
      el("div", {}, [
        el("div", { class: "ri-name", text: reward.label }),
        el("div", { class: "ri-id", text: reward.id }),
        learned
          ? el("span", {
              class: "ri-kind",
              text: reward.model?.frozen ? `🔒 ${LEARNED_LABEL[kindOf(reward)]}` : LEARNED_LABEL[kindOf(reward)],
              title: reward.model?.frozen
                ? "策略训练期间这个网络的参数是冻结的——奖励函数是静止靶，可以跨任务复用"
                : "这个网络与策略同步训练——奖励函数是移动靶",
            })
          : null,
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
        learned ? el("div", { class: "ri-weight-hint", text: "混合系数" }) : null,
      ]),
      body,
    ]
  );
}

/**
 * 学习式奖励的「来源卡」。手写奖励能列权重和公式，判别器与扩散先验不能——
 * 它们的形状藏在网络参数里，能写下来的只有四件事：吃什么、正负样本怎么定、
 * 网络多大、有哪些正则。这四行就是这类奖励全部可核对的内容。
 */
function buildModelCard(reward) {
  const m = reward.model;
  const rows = [];
  if (m.inputs?.length) rows.push(["吃什么", m.inputs.join("、")]);
  if (m.positive) rows.push(["正样本", m.positive]);
  if (m.negative) rows.push(["负样本", m.negative]);
  if (m.net) rows.push(["网络", m.net]);
  const reg = Object.entries(m.regularizers ?? {});
  if (reg.length) rows.push(["正则", reg.map(([k, v]) => `${k} = ${v}`).join("，")]);
  rows.push(["参数", m.frozen ? "训练期冻结（奖励函数是静止靶）" : "与策略同步训练（奖励函数是移动靶）"]);

  const dl = el("dl", { class: "ri-model" });
  for (const [key, value] of rows) {
    dl.append(el("dt", { text: key }), el("dd", { text: value }));
  }
  return dl;
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
