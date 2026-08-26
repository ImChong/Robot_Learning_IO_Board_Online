/**
 * 项目继承的合并逻辑。
 *
 * 为什么单独一个模块：页面（src/data.js）和校验脚本（scripts/validate.mjs）都要合并，
 * 两边各写一份必然漂移——校验通过但页面渲染出错是最难查的一类问题。
 * 所以这里不碰 DOM、不碰 fetch，只做纯数据变换，两边 import 同一份。
 *
 * 用途只有一种：消融式项目——同一份环境配置，只换算法（MimicKit 的 AWR 对 DeepMimic）。
 * 逐字复制一份 700 行 JSON 会让「改一处漏两处」成为必然，而补丁文件本身就说明了
 * 「只有这两个框变了」，正好是这类项目要传达的信息。
 *
 * 刻意的限制：只允许一层。两层以上的补丁堆没人读得懂，那时就该写全量 JSON。
 */

/** 父项目里被子项目改动过的节点 / 奖励项 id，挂在合并结果上供页面高亮。 */
const TOUCHED = "__touched";

export function isInherited(project) {
  return typeof project?.inherits === "string" && project.inherits.length > 0;
}

/** 合并结果里被 overrides 命中的 id 集合（节点与奖励项混在一起，id 空间不冲突）。 */
export function touchedIds(project) {
  return project?.[TOUCHED] ?? new Set();
}

/**
 * @param {object} child  带 inherits / overrides 的项目
 * @param {object} parent 父项目的完整数据
 * @returns {object} 合并后的完整项目（新对象，不改动入参）
 */
export function mergeProject(child, parent) {
  if (isInherited(parent)) {
    throw new Error(`项目继承只允许一层：${child.id} 的父项目 ${parent.id} 自己也有 inherits`);
  }

  const { inherits, overrides, diffSummary, ...ownFields } = child;
  const touched = new Set();

  const merged = {
    ...structuredCloneish(parent),
    ...ownFields,
    id: child.id,
    inherits,
    diffSummary,
  };

  merged.modes = {};
  for (const [modeId, parentGraph] of Object.entries(parent.modes ?? {})) {
    merged.modes[modeId] = applyModeOverride(
      structuredCloneish(parentGraph),
      overrides?.[`modes.${modeId}`],
      touched
    );
  }

  // 子项目也可以整段给出一个父项目没有的模式。
  for (const [modeId, graph] of Object.entries(child.modes ?? {})) {
    merged.modes[modeId] = graph;
  }

  merged[TOUCHED] = touched;
  return merged;
}

function applyModeOverride(graph, patch, touched) {
  if (!patch) return graph;

  if (patch.label != null) graph.label = patch.label;
  if (patch.summary != null) graph.summary = patch.summary;
  if (patch.callouts != null) graph.callouts = patch.callouts;
  if (patch.lanes != null) graph.lanes = patch.lanes;

  if (patch.facts) {
    graph.facts = graph.facts ?? [];
    for (const [label, value] of Object.entries(patch.facts)) {
      const existing = graph.facts.find((f) => f.label === label);
      if (existing) existing.value = value;
      else graph.facts.push({ label, value });
    }
  }

  graph.nodes = patchList(graph.nodes ?? [], patch, "nodes", touched);
  graph.rewards = patchList(graph.rewards ?? [], patch, "rewards", touched);

  if (patch["edges-"]?.length) {
    const drop = new Set(patch["edges-"]);
    graph.edges = (graph.edges ?? []).filter((e) => !drop.has(`${e.from}>${e.to}`));
  }
  if (patch["edges+"]?.length) {
    graph.edges = [...(graph.edges ?? []), ...patch["edges+"]];
  }

  return graph;
}

/** nodes / rewards 共用：按 id 浅合并，配套的 + / - 键做增删。 */
function patchList(list, patch, key, touched) {
  let out = list;

  const drop = patch[`${key}-`];
  if (drop?.length) {
    const dropSet = new Set(drop);
    for (const id of dropSet) touched.add(id);
    out = out.filter((item) => !dropSet.has(item.id));
  }

  const edits = patch[key];
  if (edits) {
    out = out.map((item) => {
      const edit = edits[item.id];
      if (!edit) return item;
      touched.add(item.id);
      return { ...item, ...edit };
    });
  }

  const add = patch[`${key}+`];
  if (add?.length) {
    for (const item of add) touched.add(item.id);
    out = [...out, ...add];
  }

  return out;
}

/** structuredClone 在 Node 与浏览器里都有，但旧环境没有；JSON 兜底足够——数据全是纯 JSON。 */
function structuredCloneish(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
