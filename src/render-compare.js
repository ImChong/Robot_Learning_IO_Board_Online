/** 对比视图：两个项目在同一模式下的关键指标、奖励项与观测维度对照。 */

import { el, clear } from "./dom.js";

/**
 * 对比视图：当前项目 vs 一个选定的对比对象。
 *
 * 刻意只比两个而不是全部项目——项目多起来之后，几十列的表既排不下也读不动，
 * 「拿谁跟谁比」本身就是读者的问题。
 */
export function renderCompare({
  container,
  base,
  other,
  modeId,
  taxonomy,
  entries,
  compareId,
  onChangeCompare,
  loading = false,
}) {
  clear(container);

  const modeLabel = base.modes[modeId]?.label ?? modeId;
  container.append(
    el("div", { class: "section-head" }, [
      el("h2", { text: `${modeLabel}对比` }),
      el("p", {
        text:
          "同一模式下逐项对照。差异行标为橙色；奖励表里 ● 表示两边同名同权重，＋ 表示只有一边有这一项。",
      }),
    ])
  );

  const candidates = entries.filter((entry) => entry.id !== base.id);
  container.append(
    el("div", { class: "cmp-controls" }, [
      el("span", { text: `把 ${base.name} 与` }),
      candidates.length
        ? el(
            "select",
            {
              class: "cmp-select",
              "aria-label": "选择对比对象",
              onChange: (event) => onChangeCompare(event.target.value),
            },
            candidates.map((entry) =>
              el("option", {
                value: entry.id,
                selected: entry.id === compareId,
                text: entry.name,
              })
            )
          )
        : el("span", { text: "（暂无其他项目）" }),
      el("span", { text: "对比" }),
    ])
  );

  if (!candidates.length) {
    container.append(
      el("p", { class: "reward-scale-note", text: "注册表里只有一个项目，加入第二个后即可对比。" })
    );
    return;
  }

  if (loading || !other) {
    container.append(el("p", { class: "reward-scale-note", text: "正在加载对比项目…" }));
    return;
  }

  if (!other.modes[modeId]) {
    container.append(
      el("p", {
        class: "reward-scale-note",
        text: `${other.name} 没有提供「${modeLabel}」这个模式，换一个模式或对比对象。`,
      })
    );
    return;
  }

  const pair = [base, other];
  container.append(factsTable(pair, modeId));
  container.append(obsTable(pair, modeId, taxonomy));
  if (modeId === "train") {
    container.append(rewardTable(pair, modeId, taxonomy));
  } else {
    container.append(
      el("p", {
        class: "reward-scale-note",
        text: `${modeLabel}没有奖励项对照——奖励只在训练期存在，切到训练态可以看逐项对照。`,
      })
    );
  }
}

function tableWrap(children) {
  return el("div", { class: "cmp-table-wrap" }, children);
}

function head(projects, firstLabel) {
  return el("thead", {}, [
    el("tr", {}, [
      el("th", { scope: "col", text: firstLabel }),
      ...projects.map((p) => el("th", { scope: "col", text: p.name })),
    ]),
  ]);
}

/* ---------- 关键指标 ---------- */

function factsTable(projects, modeId) {
  const labels = [];
  const seen = new Set();
  for (const project of projects) {
    for (const fact of project.modes[modeId].facts ?? []) {
      if (seen.has(fact.label)) continue;
      seen.add(fact.label);
      labels.push(fact.label);
    }
  }

  const body = el("tbody");
  for (const label of labels) {
    const values = projects.map(
      (p) => (p.modes[modeId].facts ?? []).find((f) => f.label === label)?.value ?? "—"
    );
    const differs = new Set(values).size > 1;
    body.append(
      el("tr", {}, [
        el("th", { scope: "row", text: label }),
        ...values.map((value) => el("td", { class: differs ? "cmp-diff" : "", text: value })),
      ])
    );
  }

  return tableWrap([el("table", { class: "cmp" }, [head(projects, "指标"), body])]);
}

/* ---------- 观测维度按类别 ---------- */

function obsTable(projects, modeId, taxonomy) {
  const rows = [];
  for (const cls of taxonomy.inputClasses) {
    const values = projects.map((p) => sumClass(p.modes[modeId], cls.id));
    if (values.every((v) => v.dim === 0)) continue;
    rows.push({ label: `${cls.id} · ${cls.name}`, values });
  }

  const body = el("tbody");
  for (const row of rows) {
    const differs = new Set(row.values.map((v) => v.dim)).size > 1;
    body.append(
      el("tr", {}, [
        el("th", { scope: "row", text: row.label }),
        ...row.values.map((v) =>
          el("td", {
            class: differs ? "cmp-diff" : "",
            text: v.dim ? `${v.dim} 维 · ${v.count} 项` : "—",
          })
        ),
      ])
    );
  }

  const deployable = projects.map((p) => sumDeployable(p.modes[modeId]));
  body.append(
    el("tr", {}, [
      el("th", { scope: "row", text: "非特权观测合计" }),
      ...deployable.map((v) => el("td", { class: "cmp-diff", text: `${v} 维` })),
    ])
  );

  return tableWrap([
    el("table", { class: "cmp" }, [head(projects, "观测类别"), body]),
    el("p", {
      class: "reward-scale-note",
      text:
        "两点读法上的坑：同一个量在不同项目里可能落进不同类别（带历史窗口的动作序列算 C 类时序上下文，单帧的上一动作算 A 类本体感知）；" +
        "另外「非特权观测合计」不等于策略网络的输入维度——走编码器的项目会先把参考侧观测压成 token 再进主干。",
    }),
  ]);
}

function sumClass(graph, classId) {
  let dim = 0;
  let count = 0;
  for (const node of graph.nodes) {
    if (node.kind !== "obs" || node.class !== classId || node.dim == null) continue;
    if (node.id.endsWith(".concat")) continue; // 汇总节点不参与求和
    dim += node.dim;
    count += 1;
  }
  return { dim, count };
}

function sumDeployable(graph) {
  let dim = 0;
  for (const node of graph.nodes) {
    if (node.kind !== "obs" || node.dim == null) continue;
    if (node.availability === "train-only") continue;
    if (node.id.endsWith(".concat")) continue;
    dim += node.dim;
  }
  return dim;
}

/* ---------- 奖励项 ---------- */

function rewardTable(projects, modeId, taxonomy) {
  const rewardsByProject = projects.map((p) => p.modes[modeId].rewards ?? []);

  // 两个项目里同一个奖励项的函数名往往不同（motion_global_anchor_pos vs
  // tracking_anchor_pos），所以用作者标注的 canonical 键配对。
  const keyOf = (reward) => reward.canonical ?? reward.id;
  const rowMap = new Map();
  for (const [i, rewards] of rewardsByProject.entries()) {
    for (const reward of rewards) {
      const key = keyOf(reward);
      if (!rowMap.has(key)) {
        rowMap.set(key, { key, group: reward.group, label: reward.label, cells: [] });
      }
      rowMap.get(key).cells[i] = reward;
    }
  }

  const order = taxonomy.rewardGroups.map((g) => g.id);
  const rows = [...rowMap.values()].sort(
    (a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.key.localeCompare(b.key)
  );

  const body = el("tbody");
  for (const row of rows) {
    const present = row.cells.filter(Boolean).length;
    const weights = row.cells.filter(Boolean).map((r) => r.weight);
    const sameWeight = present === projects.length && new Set(weights).size === 1;
    body.append(
      el("tr", {}, [
        el("th", { scope: "row" }, [
          el("span", {
            class: `cmp-mark ${sameWeight ? "same" : "only"}`,
            text: sameWeight ? "● " : "＋ ",
            title: sameWeight ? "两边同名同权重" : "两边不一致或只有一边有",
          }),
          `${row.group} · ${row.label}`,
        ]),
        ...projects.map((_, i) => {
          const reward = row.cells[i];
          return el("td", {
            class: sameWeight ? "" : "cmp-diff",
            text: reward ? formatWeight(reward.weight) : "—",
          });
        }),
      ])
    );
  }

  const totals = rewardsByProject.map((rewards) => ({
    count: rewards.length,
    positive: rewards.filter((r) => r.weight > 0).reduce((s, r) => s + r.weight, 0),
  }));
  body.append(
    el("tr", {}, [
      el("th", { scope: "row", text: "合计" }),
      ...totals.map((t) =>
        el("td", { text: `${t.count} 项 · 正向 ${t.positive.toFixed(1)}` })
      ),
    ])
  );

  const shared = rows.filter((row) => row.cells.filter(Boolean).length === projects.length).length;
  const mostlyShared = shared >= rows.length * 0.6;

  return tableWrap([
    el("table", { class: "cmp" }, [head(projects, "奖励项（权重）"), body]),
    el("p", {
      class: "reward-scale-note",
      text: mostlyShared
        ? `共 ${rows.length} 项，其中 ${shared} 项两边同名同权重——奖励设计上分歧很小，差异主要落在观测侧与数据侧。`
        : `共 ${rows.length} 项，其中 ${shared} 项两边同名同权重。`,
    }),
  ]);
}

function formatWeight(weight) {
  return Math.abs(weight) >= 0.01 ? String(weight) : weight.toExponential(1).replace("e-", "e−");
}
