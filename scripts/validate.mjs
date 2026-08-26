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
  if (modeId === "deploy" && (graph.rewards ?? []).length) {
    fail(where, "部署态不应该有奖励项（奖励只在训练期存在）");
  }

  return nodes.size;
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

  for (const entry of registry.projects) {
    const project = await readJson(entry.file);
    if (project.id !== entry.id) {
      fail(entry.file, `文件里的 id "${project.id}" 与注册表的 "${entry.id}" 不一致`);
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
