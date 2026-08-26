/**
 * 数据加载与索引。页面不硬编码任何项目知识，全部来自 data/ 下的 JSON。
 *
 * 项目文件按需加载：projects.json 里带了足够渲染选择器的展示信息
 * （name / subtitle / group / keywords），所以项目再多，首屏也只下载
 * 注册表 + 当前项目这两份数据。
 */

import { isInherited, mergeProject } from "./inherit.js";

const DATA_BASE = "data/";

async function fetchJson(name) {
  const res = await fetch(DATA_BASE + name, { cache: "no-cache" });
  if (!res.ok) throw new Error(`加载 ${name} 失败：HTTP ${res.status}`);
  return res.json();
}

function indexBy(list, key = "id") {
  return new Map((list ?? []).map((item) => [item[key], item]));
}

export async function loadCore() {
  const [taxonomyRaw, registry] = await Promise.all([
    fetchJson("taxonomy.json"),
    fetchJson("projects.json"),
  ]);

  const taxonomy = {
    ...taxonomyRaw,
    inputClassById: indexBy(taxonomyRaw.inputClasses),
    outputClassById: indexBy(taxonomyRaw.outputClasses),
    rewardGroupById: indexBy(taxonomyRaw.rewardGroups),
    acquisitionById: indexBy(taxonomyRaw.acquisition),
    availabilityById: indexBy(taxonomyRaw.availability),
    confidenceById: indexBy(taxonomyRaw.confidence),
    edgeKindById: indexBy(taxonomyRaw.edgeKinds),
    laneById: indexBy(taxonomyRaw.lanes),
  };
  taxonomy.classById = new Map([...taxonomy.inputClassById, ...taxonomy.outputClassById]);

  const entries = [...registry.projects].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)
  );

  const cache = new Map();
  const inflight = new Map();
  const entryById = indexBy(entries);

  /**
   * 按 id 取项目完整数据，结果缓存；并发请求同一个项目只发一次。
   *
   * 消融式项目（带 inherits）会先把父项目取回来再合并。父项目走同一份缓存与
   * inflight 表，所以「同时切两个共享同一父项目的子项目」不会重复拉父文件。
   */
  async function loadProject(id) {
    if (cache.has(id)) return cache.get(id);
    if (inflight.has(id)) return inflight.get(id);

    const entry = entryById.get(id);
    if (!entry) throw new Error(`未注册的项目：${id}`);

    const promise = fetchJson(entry.file)
      .then(async (project) => {
        const resolved = isInherited(project)
          ? mergeProject(project, await loadProject(project.inherits))
          : project;
        cache.set(id, resolved);
        inflight.delete(id);
        return resolved;
      })
      .catch((error) => {
        inflight.delete(id);
        throw error;
      });
    inflight.set(id, promise);
    return promise;
  }

  return {
    taxonomy,
    registry,
    entries,
    entryById,
    groups: registry.groups ?? [],
    loadProject,
    isLoaded: (id) => cache.has(id),
  };
}

/** 节点的展示配色：优先用类别色，非观测节点用中性色。 */
export function nodeColor(node, taxonomy) {
  const cls = node.class ? taxonomy.classById.get(node.class) : null;
  if (cls) return cls.color;
  return { proc: "#7d8794", net: "#8ab4f8", act: "#ff9f45", plant: "#9aa4b2", signal: "#c792ea" }[
    node.kind
  ] ?? "#7d8794";
}
