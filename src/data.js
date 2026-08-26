/** 数据加载与索引。页面不硬编码任何项目知识，全部来自 data/ 下的 JSON。 */

const DATA_BASE = "data/";

async function fetchJson(name) {
  const res = await fetch(DATA_BASE + name, { cache: "no-cache" });
  if (!res.ok) throw new Error(`加载 ${name} 失败：HTTP ${res.status}`);
  return res.json();
}

function indexBy(list, key = "id") {
  return new Map(list.map((item) => [item[key], item]));
}

export async function loadAll() {
  const [taxonomyRaw, registry] = await Promise.all([
    fetchJson("taxonomy.json"),
    fetchJson("projects.json"),
  ]);

  const entries = [...registry.projects].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const projects = await Promise.all(entries.map((entry) => fetchJson(entry.file)));

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

  return { taxonomy, registry, projects, projectById: indexBy(projects) };
}

/** 节点的展示配色：优先用类别色，非观测节点用中性色。 */
export function nodeColor(node, taxonomy) {
  const cls = node.class ? taxonomy.classById.get(node.class) : null;
  if (cls) return cls.color;
  return { proc: "#7d8794", net: "#8ab4f8", act: "#ff9f45", plant: "#9aa4b2", signal: "#c792ea" }[
    node.kind
  ] ?? "#7d8794";
}