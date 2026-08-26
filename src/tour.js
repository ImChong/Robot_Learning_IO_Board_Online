/**
 * 讲解序列：把一张图排成代码里真正的执行顺序。
 *
 * 顺序刻意不写进数据文件。每个项目手抄一份步骤表，等于把「图」和「讲解」
 * 拆成两份要同步维护的东西，加节点时漏改一处就会讲到一个图上没有的模块。
 * 这里从图本身推，规则只有两条：
 *
 *   1. 默认按读图顺序：泳道从左到右，泳道内按数据里的先后。这正是布局的顺序，
 *      所以讲解的推进方向和读者眼睛扫过的方向一致。
 *   2. 数据依赖优先：一个模块的全部前置模块都讲完了，它才能出场。只有存在
 *      依赖时才会打破规则 1，图排得规整时两条规则给出同一个结果。
 *
 * 回路边（右边指回左边、同列里指回上面的）不参与排序。它们是「下一拍的事」，
 * 不是「下一步」：算进去整张图就成了环，根本排不出顺序。它们在讲解词里单独
 * 占一行，正好说明这条线为什么要绕回去。
 */

/** 有向边在读图顺序上是否向前。回路边靠这个判定被排除在排序之外。 */
function isForward(edge, order) {
  const a = order.get(edge.from);
  const b = order.get(edge.to);
  if (!a || !b) return false;
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

/**
 * @param {object} graph 某个模式的图（modes[modeId]）
 * @returns {{steps: Array, stages: Array}} steps 覆盖图里每个节点，且每个只出现一次
 */
export function buildTour(graph) {
  const nodes = graph?.nodes ?? [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const lanes = graph?.lanes ?? [];
  const laneIndex = new Map(lanes.map((id, i) => [id, i]));

  // 读图顺序的排序键：[泳道列号, 数据里的下标]。没声明泳道的节点排到最右。
  const order = new Map(
    nodes.map((node, i) => [node.id, [laneIndex.get(node.lane) ?? lanes.length, i]])
  );
  const byReading = (x, y) => {
    const a = order.get(x);
    const b = order.get(y);
    return a[0] - b[0] || a[1] - b[1];
  };

  const edges = (graph?.edges ?? []).filter((e) => nodeById.has(e.from) && nodeById.has(e.to));
  const forward = [];
  const loops = [];
  for (const edge of edges) (isForward(edge, order) ? forward : loops).push(edge);

  // Kahn 拓扑排序，就绪集合里永远取读图顺序最靠前的那个。
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const successors = new Map();
  for (const edge of forward) {
    indegree.set(edge.to, indegree.get(edge.to) + 1);
    push(successors, edge.from, edge.to);
  }

  const ready = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const sequence = [];
  while (ready.length) {
    ready.sort(byReading);
    const id = ready.shift();
    sequence.push(id);
    for (const to of successors.get(id) ?? []) {
      const left = indegree.get(to) - 1;
      indegree.set(to, left);
      if (left === 0) ready.push(to);
    }
  }
  // forward 是按一个全序筛出来的，理论上不可能成环。真剩下了也得讲到——
  // 讲解漏掉一个模块比顺序不完美严重得多。
  if (sequence.length < nodes.length) {
    const seen = new Set(sequence);
    sequence.push(
      ...nodes
        .map((node) => node.id)
        .filter((id) => !seen.has(id))
        .sort(byReading)
    );
  }

  const inbound = new Map();
  const outbound = new Map();
  for (const edge of forward) {
    push(inbound, edge.to, edge);
    push(outbound, edge.from, edge);
  }
  const loopBack = new Map(); // 从这里绕回去的
  const loopIn = new Map(); // 绕回到这里的
  for (const edge of loops) {
    push(loopBack, edge.from, edge);
    push(loopIn, edge.to, edge);
  }

  // 阶段 = 讲解序列里连续同泳道的一段。读者据此知道「这一列讲完了」。
  const stages = [];
  for (const id of sequence) {
    const laneId = nodeById.get(id).lane;
    const last = stages[stages.length - 1];
    if (last && last.laneId === laneId) last.ids.push(id);
    else stages.push({ laneId, ids: [id] });
  }
  const stageOf = new Map();
  stages.forEach((stage, i) => {
    for (const id of stage.ids) stageOf.set(id, i);
  });

  const link = (edge, self) => ({
    edge,
    node: nodeById.get(edge.from === self ? edge.to : edge.from),
  });

  const steps = sequence.map((id, index) => {
    const stageIndex = stageOf.get(id);
    return {
      id,
      index,
      node: nodeById.get(id),
      laneId: nodeById.get(id).lane,
      stageIndex,
      stageCount: stages.length,
      // 一段的第一个模块要先交代「现在进到哪一列」，中间的不必重复。
      stageStart: stages[stageIndex].ids[0] === id,
      inputs: (inbound.get(id) ?? []).map((edge) => link(edge, id)),
      outputs: (outbound.get(id) ?? []).map((edge) => link(edge, id)),
      loopsOut: (loopBack.get(id) ?? []).map((edge) => link(edge, id)),
      loopsIn: (loopIn.get(id) ?? []).map((edge) => link(edge, id)),
    };
  });

  return { steps, stages };
}
