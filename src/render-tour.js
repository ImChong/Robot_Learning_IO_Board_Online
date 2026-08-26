/**
 * 讲解面板：当前这一步在讲哪个模块、它从哪儿拿到东西、算完给谁、代码在哪一行。
 *
 * 解说词不另写一份，全部取自节点自己的 desc / note / source——那是逐项核对过的
 * 内容，另写一份就等于同一件事有两个说法，早晚对不上。面板负责的是把这些字段
 * 按「运行到这一步时读者想知道什么」的顺序摆出来，并补上图里看得见、字段里
 * 没有的关系：上一步是谁、下一步是谁、哪条线是绕回去的。
 */

import { el, clear } from "./dom.js";
import { nodeColor } from "./data.js";
import { sourceLink } from "./render-detail.js";

/**
 * 自动播放时这一步停留多久。按解说词长度算，短的不至于一闪而过，
 * 长的也不会读到一半被翻页；上下限保证节奏不失控。
 */
export function dwellFor(step) {
  const text = `${step.node.desc ?? ""}${step.node.note ?? ""}`;
  return Math.min(7000, Math.max(2600, 1600 + text.length * 45));
}

function relation(items, arrow) {
  return items.map(({ edge, node }) =>
    el("span", { class: "tf-item" }, [
      el("span", { class: "tf-arrow", "aria-hidden": "true", text: arrow }),
      el("span", { class: "tf-name", text: node?.label ?? "—" }),
      edge.label ? el("span", { class: "tf-edge", text: edge.label }) : null,
    ])
  );
}

function flowRow(label, items, arrow) {
  if (!items.length) return null;
  return el("div", { class: "tf-row" }, [
    el("span", { class: "tf-key", text: label }),
    el("span", { class: "tf-items" }, relation(items, arrow)),
  ]);
}

export function renderTour({
  container,
  steps,
  index,
  playing,
  taxonomy,
  modeLabel,
  onPrev,
  onNext,
  onToggle,
  onExit,
}) {
  const step = steps[index];
  if (!step) return;

  // 每一步都是整块重建，所以要在拆掉旧 DOM 之前记住键盘焦点落在哪个按钮上，
  // 否则用「下一步」翻两下，焦点就掉回 body，后面的 Tab 得从头按起。
  const oldControls = container.querySelector(".tour-controls");
  const focusedIndex =
    oldControls && oldControls.contains(document.activeElement)
      ? [...oldControls.children].indexOf(document.activeElement)
      : -1;

  clear(container);
  // 上一步如果很长，读者可能把面板滚到了下面；换步了就得从头开始读。
  container.scrollTop = 0;

  const { node } = step;
  const total = steps.length;
  const atStart = index === 0;
  const atEnd = index === total - 1;
  const lane = taxonomy.laneById.get(step.laneId);
  const cls = node.class ? taxonomy.classById.get(node.class) : null;
  const acq = node.acquisition ? taxonomy.acquisitionById.get(node.acquisition) : null;
  const avail = node.availability ? taxonomy.availabilityById.get(node.availability) : null;
  const kindName = taxonomy.nodeKinds.find((k) => k.id === node.kind)?.name;

  container.append(
    el("div", { class: "tour-head" }, [
      el("span", { class: "tour-kicker" }, [
        el("span", { class: "tour-dot", "aria-hidden": "true" }),
        `按运行顺序讲解 · ${modeLabel}`,
      ]),
      el("button", {
        class: "tour-close",
        type: "button",
        "aria-label": "退出讲解",
        title: "退出讲解（Esc）",
        text: "✕",
        onClick: onExit,
      }),
    ]),

    // 上面一条是「讲到哪儿了」，下面一条是自动播放时这一步还剩多久。
    el("div", { class: "tour-bars" }, [
      el("div", { class: "tour-progress" }, [
        el("span", { style: { width: `${((index + 1) / total) * 100}%` } }),
      ]),
      playing && !atEnd
        ? el("div", { class: "tour-dwell" }, [
            el("span", { style: { animationDuration: `${dwellFor(step)}ms` } }),
          ])
        : null,
    ]),

    el("p", { class: "tour-meta" }, [
      el("b", { text: `第 ${index + 1} / ${total} 步` }),
      ` · 阶段 ${step.stageIndex + 1}/${step.stageCount} · ${lane?.name ?? step.laneId}`,
    ])
  );

  // 进到新的一列时先交代这一列在整轮里干什么，读者才知道位置变了不是跳了。
  if (step.stageStart && lane?.desc) {
    container.append(
      el("div", { class: "tour-stage" }, [
        el("b", { text: `进入「${lane.name}」` }),
        el("span", { text: lane.desc }),
      ])
    );
  }

  container.append(
    el("h2", { class: "tour-title", style: { borderColor: nodeColor(node, taxonomy) } }, [
      node.label,
    ])
  );
  if (node.sub) container.append(el("p", { class: "tour-sub", text: node.sub }));

  const badges = [
    cls ? el("span", { class: "badge strong", style: { background: cls.color }, text: `${cls.id} · ${cls.name}`, title: cls.desc }) : el("span", { class: "badge", text: kindName ?? node.kind }),
    node.dim != null ? el("span", { class: "badge", text: node.dimExpr ? `${node.dim} 维 = ${node.dimExpr}` : `${node.dim} 维` }) : null,
    acq && acq.id !== "none" ? el("span", { class: "badge", text: `${acq.icon} ${acq.name}`, title: acq.desc }) : null,
    avail && avail.id !== "n/a" && avail.id !== "deploy-ok" ? el("span", { class: "badge warn", text: avail.name, title: avail.desc }) : null,
    node.freqHz ? el("span", { class: "badge", text: `${node.freqHz} Hz` }) : null,
  ].filter(Boolean);
  container.append(el("div", { class: "tour-badges" }, badges));

  if (node.desc) container.append(el("p", { class: "tour-desc", text: node.desc }));
  if (node.note) container.append(el("p", { class: "tour-note", text: node.note }));

  const flow = [
    flowRow("上一步给它", step.inputs, "←"),
    flowRow("算完交给", step.outputs, "→"),
    // 回路边不参与排序，但正是它让这张图转起来，得说清楚它指回哪儿。
    flowRow("绕回去（下一拍才用到）", step.loopsOut, "↺"),
  ].filter(Boolean);
  if (flow.length) container.append(el("div", { class: "tour-flow" }, flow));

  if (node.source) {
    const link = sourceLink(node.source);
    container.append(
      el("div", { class: "tour-code" }, [
        el("span", { class: "tf-key", text: "代码" }),
        el("span", {}, [
          link
            ? el("a", { href: link, target: "_blank", rel: "noopener", text: node.source.path })
            : el("code", { text: node.source.path }),
          node.source.symbol ? el("code", { text: node.source.symbol }) : null,
        ]),
      ])
    );
  }

  container.append(
    el("div", { class: "tour-controls" }, [
      el("button", {
        class: "icon-btn",
        type: "button",
        text: "‹ 上一步",
        disabled: atStart,
        onClick: onPrev,
      }),
      el("button", {
        class: "icon-btn play",
        type: "button",
        "aria-pressed": String(playing),
        text: atEnd ? "↻ 重新讲一遍" : playing ? "⏸ 暂停" : "▶ 播放",
        onClick: onToggle,
      }),
      el("button", {
        class: "icon-btn",
        type: "button",
        text: "下一步 ›",
        disabled: atEnd,
        onClick: onNext,
      }),
    ]),
    el("p", { class: "hint", text: "空格 播放 / 暂停 · ← → 前后一步 · 点图上任意模块跳到那一步 · Esc 退出" })
  );

  if (focusedIndex >= 0) {
    const buttons = [...container.querySelectorAll(".tour-controls .icon-btn")];
    // 原来那个按钮到了头尾会变灰，焦点退到中间的播放键，别落到不可点的东西上。
    const next = buttons[focusedIndex];
    // preventScroll：focus() 默认会把按钮滚进视野，那会把面板顶到底部，
    // 读者看到的是三个按钮而不是这一步的解说词。
    (next && !next.disabled ? next : buttons[1])?.focus({ preventScroll: true });
  }
}
