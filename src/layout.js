/**
 * 泳道布局：lane 决定列，数组顺序决定列内纵向次序，每列整体垂直居中。
 *
 * 不用力导向布局是刻意的——「输入 → 网络 → 输出」天然是分层 DAG，
 * 泳道布局每次打开位置一致，方便截图和对着图讨论。
 */

export const NODE_W = 208;
export const COL_GAP = 92;
export const ROW_GAP = 14;
export const LANE_HEAD_H = 28;

export function computeLayout(graph, heights) {
  const lanes = graph.lanes;
  const laneIndex = new Map(lanes.map((id, i) => [id, i]));

  // 先按列收集节点，算出每列的自然高度。
  const byLane = new Map(lanes.map((id) => [id, []]));
  for (const node of graph.nodes) {
    byLane.get(node.lane)?.push(node);
  }

  const laneHeights = new Map();
  for (const [laneId, nodes] of byLane) {
    let h = 0;
    for (const node of nodes) h += (heights.get(node.id) ?? 64) + ROW_GAP;
    laneHeights.set(laneId, Math.max(0, h - ROW_GAP));
  }
  const maxLaneH = Math.max(0, ...laneHeights.values());

  const pos = new Map();
  const laneBoxes = [];
  for (const [laneId, nodes] of byLane) {
    const x = laneIndex.get(laneId) * (NODE_W + COL_GAP);
    const laneH = laneHeights.get(laneId);
    let y = LANE_HEAD_H + (maxLaneH - laneH) / 2;
    laneBoxes.push({ id: laneId, x, top: y, height: laneH });
    for (const node of nodes) {
      const h = heights.get(node.id) ?? 64;
      pos.set(node.id, { x, y, w: NODE_W, h });
      y += h + ROW_GAP;
    }
  }

  return {
    pos,
    laneBoxes,
    width: Math.max(NODE_W, lanes.length * (NODE_W + COL_GAP) - COL_GAP),
    height: LANE_HEAD_H + maxLaneH,
  };
}

/** 折线转带圆角的路径。用于回路通道走线。 */
export function roundedPolyline(points, radius = 10) {
  if (points.length < 2) return "";
  const parts = [`M ${points[0][0]} ${points[0][1]}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) {
      parts.push(`L ${cx} ${cy}`);
      continue;
    }
    const t1 = [cx + ((px - cx) / inLen) * r, cy + ((py - cy) / inLen) * r];
    const t2 = [cx + ((nx - cx) / outLen) * r, cy + ((ny - cy) / outLen) * r];
    parts.push(`L ${t1[0].toFixed(1)} ${t1[1].toFixed(1)}`);
    parts.push(`Q ${cx} ${cy} ${t2[0].toFixed(1)} ${t2[1].toFixed(1)}`);
  }
  const last = points[points.length - 1];
  parts.push(`L ${last[0]} ${last[1]}`);
  return parts.join(" ");
}

/** 同列或向前的边：水平三次贝塞尔。 */
export function forwardPath(x1, y1, x2, y2) {
  const dx = Math.max(36, (x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/** 向后的边（回路闭合）：绕到上方或下方的通道里走。 */
export function channelPath(x1, y1, x2, y2, channelY) {
  const xa = x1 + 26;
  const xb = x2 - 26;
  return roundedPolyline(
    [
      [x1, y1],
      [xa, y1],
      [xa, channelY],
      [xb, channelY],
      [xb, y2],
      [x2, y2],
    ],
    11
  );
}
