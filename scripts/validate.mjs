#!/usr/bin/env node
/**
 * 数据自洽性检查。
 *
 * 词汇表（观测类别、获取方式、可信度、连线类型、泳道）全部从 data/taxonomy.json 读取，
 * 避免校验规则与页面渲染各自维护一份枚举。
 *
 * 用法：node scripts/validate.mjs
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { isInherited, mergeProject } from "../src/inherit.js";
import { buildTour } from "../src/tour.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");

const errors = [];
const warnings = [];

const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

const readJson = async (name) => JSON.parse(await readFile(join(DATA, name), "utf8"));

/**
 * 把「14 连杆 × 3」「(29 + 29) × 10 帧」这类混着中文的维度算式求值。
 * 剥掉非算式字符后必须仍是合法表达式，否则返回 null（跳过检查）。
 */
function evalDimExpr(expr) {
  const cleaned = expr
    .replace(/[×✕]/g, "*")
    .replace(/[−–—]/g, "+") // 装饰性减号（如「160 − 噪声 + 42」）当作分隔符
    .replace(/[^\d+*/().\s]/g, " ")
    .trim();
  if (!/^[\d+*/().\s]+$/.test(cleaned)) return null;
  if (!/\d/.test(cleaned)) return null;
  // 括号配平 + 不能有悬空运算符
  const compact = cleaned.replace(/\s+/g, "");
  if (/[+*/]{2,}/.test(compact)) return null;
  if (/^[+*/]|[+*/]$/.test(compact)) return null;
  if (/\([+*/)]/.test(compact) || /[+*/(]\)/.test(compact)) return null;
  let depth = 0;
  for (const ch of compact) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (depth < 0) return null;
  }
  if (depth !== 0) return null;
  try {
    const value = Function(`"use strict";return (${compact});`)();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function checkGraph(project, modeId, graph, taxo, sourceIndex) {
  const where = `${project.id}/${modeId}`;
  const laneSet = new Set(graph.lanes ?? []);
  if (!laneSet.size) fail(where, "缺少 lanes");
  for (const lane of graph.lanes ?? []) {
    if (!taxo.laneIds.has(lane)) fail(where, `未知泳道 "${lane}"`);
  }

  const nodes = new Map();
  for (const node of graph.nodes ?? []) {
    if (!node.id) {
      fail(where, "存在没有 id 的节点");
      continue;
    }
    if (nodes.has(node.id)) fail(where, `节点 id 重复："${node.id}"`);
    nodes.set(node.id, node);

    const at = `${where}/${node.id}`;
    if (!node.label) fail(at, "缺少 label");
    if (!node.kind) fail(at, "缺少 kind");
    else if (!taxo.nodeKindIds.has(node.kind)) fail(at, `未知 kind "${node.kind}"`);
    if (!laneSet.has(node.lane)) fail(at, `lane "${node.lane}" 未在本图的 lanes 中声明`);
    if (!node.confidence) fail(at, "缺少 confidence");
    else if (!taxo.confidenceIds.has(node.confidence)) fail(at, `未知 confidence "${node.confidence}"`);
    if (node.class && !taxo.classIds.has(node.class)) fail(at, `未知 class "${node.class}"`);
    if (node.acquisition && !taxo.acquisitionIds.has(node.acquisition)) {
      fail(at, `未知 acquisition "${node.acquisition}"`);
    }
    if (node.availability && !taxo.availabilityIds.has(node.availability)) {
      fail(at, `未知 availability "${node.availability}"`);
    }
    if (node.kind === "obs" && node.dim != null) {
      if (!node.acquisition) fail(at, "观测节点带维度但缺少 acquisition");
      if (!node.availability) fail(at, "观测节点带维度但缺少 availability");
    }

    // 只标大小不标顺序，读者没法把这一格和自己代码里的张量对上：同一台 G1，
    // MimicKit（Isaac Gym）的四元数是 (x, y, z, w)，BeyondMimic / SONIC（Isaac Lab）是 (w, x, y, z)，
    // 两边都只写「4 维」的话，这处最容易踩的坑在页面上根本看不见。
    if (node.dim != null && node.dim > 0 && !node.dimLayout) {
      const msg = `dim=${node.dim} 但没有 dimLayout（写清这几个数按什么顺序排）`;
      if (node.kind === "obs" || node.kind === "act") fail(at, msg);
      else warn(at, msg);
    }

    // 每个带维度的节点都要能追溯到出处（同项目其他模式里的同 id 节点可以继承）。
    if (node.dim != null && node.confidence !== "derived" && !sourceIndex.has(node.id)) {
      fail(at, `dim=${node.dim} 但没有 source（且其他模式里也没有同 id 节点提供出处）`);
    }

    // 维度算式必须与 dim 自洽。
    if (node.dimExpr && node.dim != null) {
      const value = evalDimExpr(node.dimExpr);
      if (value != null && value !== node.dim) {
        fail(at, `dimExpr "${node.dimExpr}" 求值为 ${value}，与 dim=${node.dim} 不符`);
      }
    }
  }

  const edges = graph.edges ?? [];
  const incoming = new Map();
  for (const [i, edge] of edges.entries()) {
    const at = `${where}/edge[${i}]`;
    if (!nodes.has(edge.from)) fail(at, `from "${edge.from}" 不存在`);
    if (!nodes.has(edge.to)) fail(at, `to "${edge.to}" 不存在`);
    if (edge.from === edge.to) fail(at, "自环");
    if (!edge.kind) fail(at, "缺少 kind");
    else if (!taxo.edgeKindIds.has(edge.kind)) fail(at, `未知连线类型 "${edge.kind}"`);
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge.from);
  }

  // 孤立节点通常是漏了连线。
  const connected = new Set();
  for (const edge of edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  for (const id of nodes.keys()) {
    if (!connected.has(id)) warn(`${where}/${id}`, "没有任何连线");
  }

  // checkSum 节点的维度必须等于全部入边源节点维度之和。
  for (const node of nodes.values()) {
    if (!node.checkSum) continue;
    const at = `${where}/${node.id}`;
    const sources = incoming.get(node.id) ?? [];
    if (!sources.length) {
      fail(at, "标了 checkSum 但没有入边");
      continue;
    }
    let sum = 0;
    const missing = [];
    for (const from of sources) {
      const dim = nodes.get(from)?.dim;
      if (dim == null) missing.push(from);
      else sum += dim;
    }
    if (missing.length) {
      fail(at, `checkSum 的入边节点缺少 dim：${missing.join(", ")}`);
    } else if (sum !== node.dim) {
      fail(at, `入边维度之和为 ${sum}，与 dim=${node.dim} 不符`);
    }
  }

  const LEARNED_KINDS = new Set(["adversarial", "encoder", "generative"]);
  for (const [i, reward] of (graph.rewards ?? []).entries()) {
    const at = `${where}/reward[${reward.id ?? i}]`;
    if (!reward.id) fail(at, "缺少 id");
    if (!reward.label) fail(at, "缺少 label");
    if (typeof reward.weight !== "number") fail(at, "weight 必须是数字");
    if (!taxo.rewardGroupIds.has(reward.group)) fail(at, `未知奖励分类 "${reward.group}"`);
    if (!reward.source) fail(at, "缺少 source");
    if (!taxo.confidenceIds.has(reward.confidence)) fail(at, `未知 confidence "${reward.confidence}"`);
    if (reward.direction && !["positive", "negative"].includes(reward.direction)) {
      fail(at, `direction 只能是 positive / negative，得到 "${reward.direction}"`);
    }
    if (reward.direction === "positive" && reward.weight < 0) {
      fail(at, `标为 positive 但权重是 ${reward.weight}`);
    }
    if (reward.direction === "negative" && reward.weight > 0) {
      fail(at, `标为 negative 但权重是 ${reward.weight}`);
    }

    // 学习式奖励（判别器 / 编码器 / 生成先验）没有可列表的分项权重，
    // 信息量在 model 里：吃什么、正样本是什么、怎么变成标量、有哪些正则。
    const kind = reward.rewardKind ?? "handcrafted";
    if (!taxo.rewardKindIds.has(kind)) fail(at, `未知 rewardKind "${kind}"`);
    if (LEARNED_KINDS.has(kind)) {
      if (!reward.model) fail(at, `rewardKind=${kind} 但没有 model（学习式奖励必须说明网络本身）`);
      if (!reward.model?.inputs?.length) fail(at, "model 缺少 inputs（这个奖励看着什么打分）");
      for (const input of reward.model?.inputs ?? []) {
        if (!nodes.has(input)) fail(at, `model.inputs 里的 "${input}" 不是本图的节点`);
      }
    } else if (reward.model) {
      fail(at, `rewardKind=${kind} 不该带 model（手写与任务奖励的信息量在 form / params 里）`);
    }
  }

  const rewardIds = new Set((graph.rewards ?? []).map((r) => r.id));
  if (rewardIds.size !== (graph.rewards ?? []).length) fail(where, "奖励项 id 有重复");
  const canonicalKeys = (graph.rewards ?? []).map((r) => r.canonical ?? r.id);
  if (new Set(canonicalKeys).size !== canonicalKeys.length) {
    fail(where, "奖励项的 canonical 键在同一张图里重复了（对比视图会把它们错配成一行）");
  }

  for (const [i, fact] of (graph.facts ?? []).entries()) {
    const at = `${where}/fact[${i}]`;
    if (!fact.label) fail(at, "缺少 label");
    if (!fact.value) fail(at, "缺少 value");
  }
  const factLabels = (graph.facts ?? []).map((f) => f.label);
  if (new Set(factLabels).size !== factLabels.length) fail(where, "facts 的 label 有重复");

  if (modeId === "train" && !(graph.rewards ?? []).length) {
    warn(where, "训练态没有奖励项");
  }
  // 训练之外的任何模式（deploy / test / …）都不该有奖励：奖励只在训练期存在。
  if (modeId !== "train" && (graph.rewards ?? []).length) {
    fail(where, `模式 "${modeId}" 不应该有奖励项（奖励只在训练期存在）`);
  }
  // train-only 表示「第二个模式里消失」，出现在非训练模式里就是自相矛盾。
  if (modeId !== "train") {
    for (const node of nodes.values()) {
      if (node.availability === "train-only") {
        fail(
          `${where}/${node.id}`,
          "在非训练模式里标了 train-only；仿真直读但推理仍在用的量应该标 sim-only"
        );
      }
    }
  }

  checkTour(where, graph, nodes);

  return nodes.size;
}

/**
 * 讲解序列的自洽性。顺序是从图推出来的（src/tour.js），所以数据一改它就跟着变——
 * 这里把「不该变的部分」钉住：每个模块讲到且只讲一次，且没有哪一步先于它的
 * 前置模块出场。图排乱了不会报错，只会讲得别扭；这两条破了才是真讲错。
 */
function checkTour(where, graph, nodes) {
  const { steps } = buildTour(graph);
  const ids = steps.map((step) => step.id);
  const seen = new Set(ids);
  if (seen.size !== ids.length) fail(`${where}/tour`, "讲解序列里有模块出现了两次");
  if (seen.size !== nodes.size) {
    const missing = [...nodes.keys()].filter((id) => !seen.has(id));
    fail(`${where}/tour`, `讲解序列漏掉了 ${missing.length} 个模块：${missing.slice(0, 5).join(", ")}`);
  }

  const laneIndex = new Map((graph.lanes ?? []).map((id, i) => [id, i]));
  const authored = new Map((graph.nodes ?? []).map((node, i) => [node.id, i]));
  const at = new Map(ids.map((id, i) => [id, i]));
  for (const edge of graph.edges ?? []) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    const a = [laneIndex.get(nodes.get(edge.from).lane), authored.get(edge.from)];
    const b = [laneIndex.get(nodes.get(edge.to).lane), authored.get(edge.to)];
    const forward = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    if (forward && at.get(edge.from) > at.get(edge.to)) {
      fail(`${where}/tour`, `讲到 "${edge.to}" 时它的上游 "${edge.from}" 还没讲`);
    }
  }
}

/** overrides 里按 id 打的补丁必须命中父项目里真实存在的东西。 */
function checkPatchTargets(at, path, patch, parentGraph) {
  const nodeIds = new Set((parentGraph.nodes ?? []).map((n) => n.id));
  const rewardIds = new Set((parentGraph.rewards ?? []).map((r) => r.id));
  const edgeKeys = new Set((parentGraph.edges ?? []).map((e) => `${e.from}>${e.to}`));
  const factLabels = new Set((parentGraph.facts ?? []).map((f) => f.label));

  const check = (ids, pool, what) => {
    for (const id of ids) {
      if (!pool.has(id)) fail(at, `${path} 的 ${what} "${id}" 在父项目里不存在`);
    }
  };

  check(Object.keys(patch.nodes ?? {}), nodeIds, "nodes 补丁目标");
  check(patch["nodes-"] ?? [], nodeIds, "nodes- 删除目标");
  check(Object.keys(patch.rewards ?? {}), rewardIds, "rewards 补丁目标");
  check(patch["rewards-"] ?? [], rewardIds, "rewards- 删除目标");
  check(patch["edges-"] ?? [], edgeKeys, "edges- 删除目标");

  for (const id of (patch["nodes+"] ?? []).map((n) => n.id)) {
    if (nodeIds.has(id)) fail(at, `${path} 的 nodes+ 里 "${id}" 与父项目重名，应该用 nodes 补丁`);
  }
  for (const label of Object.keys(patch.facts ?? {})) {
    if (!factLabels.has(label)) {
      // 追加新指标是允许的，只是提醒一下，避免拼错 label 后静默多出一行。
      warn(at, `${path} 的 facts 里 "${label}" 父项目没有，会作为新指标追加`);
    }
  }
}

function checkRegistry(registry) {
  const where = "projects.json";
  const groupIds = new Set();
  for (const [i, group] of (registry.groups ?? []).entries()) {
    if (!group.id) fail(where, `groups[${i}] 缺少 id`);
    if (!group.name) fail(where, `groups[${i}] 缺少 name`);
    if (groupIds.has(group.id)) fail(where, `分组 id 重复："${group.id}"`);
    groupIds.add(group.id);
  }

  const ids = new Set();
  const files = new Set();
  for (const [i, entry] of (registry.projects ?? []).entries()) {
    const at = `${where}/projects[${i}]`;
    if (!entry.id) fail(at, "缺少 id");
    if (!entry.file) fail(at, "缺少 file");
    if (!entry.name) fail(at, "缺少 name（项目选择器要先于项目文件渲染，靠的就是这个字段）");
    if (ids.has(entry.id)) fail(at, `项目 id 重复："${entry.id}"`);
    if (files.has(entry.file)) fail(at, `项目文件重复引用："${entry.file}"`);
    ids.add(entry.id);
    files.add(entry.file);
    if (entry.group && !groupIds.has(entry.group)) fail(at, `未定义的分组 "${entry.group}"`);
    // 项目列表按 published 排序，格式写错会静默把项目甩到列表末尾。
    if (!entry.published) fail(at, "缺少 published（项目列表按发布时间排序，缺了就排不进去）");
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.published)) {
      fail(at, `published "${entry.published}" 不是 YYYY-MM-DD`);
    } else if (Number.isNaN(Date.parse(entry.published))) {
      fail(at, `published "${entry.published}" 不是有效日期`);
    }
    if (entry.keywords && !Array.isArray(entry.keywords)) fail(at, "keywords 必须是数组");
    for (const keyword of entry.keywords ?? []) {
      if (typeof keyword !== "string") fail(at, "keywords 里出现了非字符串");
    }
  }

  if (!ids.size) fail(where, "没有注册任何项目");
  if (registry.defaultProject && !ids.has(registry.defaultProject)) {
    fail(where, `defaultProject "${registry.defaultProject}" 不在已注册项目里`);
  }
}

async function main() {
  const taxonomy = await readJson("taxonomy.json");
  const registry = await readJson("projects.json");

  const taxo = {
    laneIds: new Set(taxonomy.lanes.map((l) => l.id)),
    nodeKindIds: new Set(taxonomy.nodeKinds.map((k) => k.id)),
    confidenceIds: new Set(taxonomy.confidence.map((c) => c.id)),
    acquisitionIds: new Set(taxonomy.acquisition.map((a) => a.id)),
    availabilityIds: new Set(taxonomy.availability.map((a) => a.id)),
    edgeKindIds: new Set(taxonomy.edgeKinds.map((e) => e.id)),
    rewardGroupIds: new Set(taxonomy.rewardGroups.map((g) => g.id)),
    rewardKindIds: new Set(["handcrafted", "task", "adversarial", "encoder", "generative"]),
    classIds: new Set([
      ...taxonomy.inputClasses.map((c) => c.id),
      ...taxonomy.outputClasses.map((c) => c.id),
    ]),
  };

  for (const [key, ids] of Object.entries(taxo)) {
    if (!ids.size) fail("taxonomy.json", `${key} 为空`);
  }

  let totalNodes = 0;
  let totalRewards = 0;

  checkRegistry(registry);

  // 先把所有文件读进来，消融式项目要能引到父项目。
  const raw = new Map();
  for (const entry of registry.projects) {
    raw.set(entry.id, await readJson(entry.file));
  }

  for (const entry of registry.projects) {
    let project = raw.get(entry.id);

    if (isInherited(project)) {
      const at = `${entry.file}`;
      const parent = raw.get(project.inherits);
      if (!parent) {
        fail(at, `inherits 指向的父项目 "${project.inherits}" 没有在注册表里登记`);
        continue;
      }
      if (isInherited(parent)) {
        fail(at, `项目继承只允许一层，但父项目 "${parent.id}" 自己也有 inherits`);
        continue;
      }
      if (!project.diffSummary) {
        fail(at, "带 inherits 就必须写 diffSummary（页面顶部要直接告诉读者差在哪）");
      }
      // overrides 的路径必须命中东西，否则是写错了模式 id 或节点 id 的静默失效。
      for (const [path, patch] of Object.entries(project.overrides ?? {})) {
        const modeId = path.startsWith("modes.") ? path.slice("modes.".length) : null;
        const parentGraph = modeId ? parent.modes?.[modeId] : null;
        if (!parentGraph) {
          fail(at, `overrides 的键 "${path}" 在父项目里找不到对应模式`);
          continue;
        }
        checkPatchTargets(at, path, patch, parentGraph);
      }
      try {
        project = mergeProject(project, parent);
      } catch (error) {
        fail(at, String(error.message ?? error));
        continue;
      }
    }

    if (project.id !== entry.id) {
      fail(entry.file, `文件里的 id "${project.id}" 与注册表的 "${entry.id}" 不一致`);
    }
    // 注册表冗余了 name/subtitle，好让项目选择器不必先下载每个项目文件；
    // 冗余就必须校验，否则两处会各自漂移。
    if (entry.name && project.name && entry.name !== project.name) {
      fail("projects.json", `${entry.id} 的 name 与项目文件不一致（"${entry.name}" vs "${project.name}"）`);
    }
    if (entry.subtitle && project.subtitle && entry.subtitle !== project.subtitle) {
      fail(
        "projects.json",
        `${entry.id} 的 subtitle 与项目文件不一致（"${entry.subtitle}" vs "${project.subtitle}"）`
      );
    }
    if (!project.verifiedAt) warn(entry.file, "缺少 verifiedAt");
    if (!project.verifiedRef) warn(entry.file, "缺少 verifiedRef");

    const modes = Object.entries(project.modes ?? {});
    if (!modes.length) fail(entry.file, "没有任何模式");

    // 出处索引：同一项目内，任一模式给出的 source 可以被其他模式的同 id 节点继承。
    const sourceIndex = new Map();
    for (const [, graph] of modes) {
      for (const node of graph.nodes ?? []) {
        if (node.source && !sourceIndex.has(node.id)) sourceIndex.set(node.id, node.source);
      }
    }

    for (const [modeId, graph] of modes) {
      totalNodes += checkGraph(project, modeId, graph, taxo, sourceIndex);
      totalRewards += (graph.rewards ?? []).length;
    }
  }

  const label = (n, unit) => `${n} ${unit}`;
  if (warnings.length) {
    console.log(`\n提示（${warnings.length}）：`);
    for (const w of warnings) console.log(`  · ${w}`);
  }
  if (errors.length) {
    console.error(`\n校验失败（${errors.length} 项）：`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log(
    `\n校验通过：${label(registry.projects.length, "个项目")}，${label(totalNodes, "个节点")}，${label(totalRewards, "个奖励项")}。`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
