/**
 * 奖励曲线：一张折线图 + 每个可调参数一根滑块。
 *
 * 纵轴是公式本身的值（未乘权重），横轴是公式里的那个误差 / 状态量；曲线规格由
 * reward-curve.js 从数据推出来。拖滑块时实线跟着变，数据里的原值留一条虚线作参照，
 * 「把 σ 调大一倍，钟形宽了多少」一眼可见。悬停有十字线读数。
 *
 * 横轴范围按数据值定死、不随滑块缩放：否则高斯核换了 σ，坐标跟着伸缩，
 * 画出来永远是同一条钟形，滑块就白拖了。
 */

import { el, svgEl, clear, queueMath } from "./dom.js";
import { defaults, sample } from "./reward-curve.js";

const W = 360;
const H = 168;
const M = { l: 40, r: 12, t: 14, b: 22 };
/** 滑块的整数刻度数：对数滑块也要足够细，σ 这类参数才能停在常见值附近。 */
const STEPS = 1000;

let uid = 0;

/** 数字的展示：最多三位有效数字，负号用真正的减号。 */
export function fmt(n) {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  const text = abs >= 1e4 || abs < 1e-3 ? n.toExponential(1) : String(Number(n.toPrecision(3)));
  return text.replace(/^-/, "−").replace("e-", "e−");
}

/** 1-2-5 序列的「好看」刻度。 */
function ticks(lo, hi, count = 4) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= count + 0.5) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step)
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

const toSlider = (p, value) =>
  Math.round(
    (p.log ? Math.log(value / p.min) / Math.log(p.max / p.min) : (value - p.min) / (p.max - p.min)) * STEPS,
  );
const fromSlider = (p, t) => {
  const v = p.log ? p.min * (p.max / p.min) ** (t / STEPS) : p.min + ((p.max - p.min) * t) / STEPS;
  return p.int ? Math.round(v) : v;
};

/**
 * @param {object} opts
 * @param {object} opts.spec    curveFor(reward) 的结果（kind === "curve"）
 * @param {object} opts.reward  奖励项本身（标签、权重）
 */
export function renderCurve({ spec, reward }) {
  const base = defaults(spec);
  const values = { ...base };
  const root = el("div", { class: "rc" });

  const svg = svgEl("svg", {
    class: "rc-plot",
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": `${reward.label}：奖励值随横轴变化的曲线`,
  });
  const layer = svgEl("g");
  const hover = svgEl("g", { class: "rc-hover", visibility: "hidden" }, [
    svgEl("line", { class: "rc-cross", y1: M.t, y2: H - M.b }),
    svgEl("circle", { class: "rc-dot", r: 4 }),
  ]);
  const hit = svgEl("rect", {
    class: "rc-hit",
    x: M.l,
    y: M.t,
    width: W - M.l - M.r,
    height: H - M.t - M.b,
  });
  svg.append(layer, hover, hit);

  const xLabel = el("span", { class: "rc-xtex" });
  queueMath(xLabel, spec.xTex);
  const readout = el("p", { class: "rc-readout" });
  const legend = el("p", { class: "rc-legend", "aria-hidden": "true" }, [
    el("span", { class: "rc-key now" }),
    "当前参数",
    el("span", { class: "rc-key base" }),
    "数据值",
  ]);
  const reset = el("button", {
    class: "rc-reset",
    type: "button",
    text: "↺ 复位到数据值",
    onClick: () => {
      Object.assign(values, base);
      for (const row of rows) row.sync();
      draw();
    },
  });

  let scales = null;

  function changed() {
    return spec.params.some((p) => Math.abs(values[p.id] - base[p.id]) > 1e-12);
  }

  function draw() {
    clear(layer);
    const now = sample(spec, values);
    const ref = changed() ? sample(spec, base) : null;
    const ys = [...now, ...(ref ?? [])].map(([, y]) => y).filter(Number.isFinite);
    let lo = Math.min(0, ...ys);
    let hi = Math.max(0, ...ys);
    if (hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.06;
    lo -= lo < 0 ? pad : 0;
    hi += pad;
    const [a, b] = spec.x;
    const sx = (x) => M.l + ((x - a) / (b - a)) * (W - M.l - M.r);
    const sy = (y) => H - M.b - ((y - lo) / (hi - lo)) * (H - M.t - M.b);
    scales = { sx, sy, a, b };

    for (const t of ticks(lo, hi, 3)) {
      layer.append(
        svgEl("line", { class: t === 0 ? "rc-zero" : "rc-grid", x1: M.l, x2: W - M.r, y1: sy(t), y2: sy(t) }),
        svgEl("text", { class: "rc-tick", x: M.l - 5, y: sy(t) + 3, "text-anchor": "end", text: fmt(t) }),
      );
    }
    for (const t of ticks(a, b, 4)) {
      layer.append(
        svgEl("text", { class: "rc-tick", x: sx(t), y: H - M.b + 13, "text-anchor": "middle", text: fmt(t) }),
      );
    }
    for (const mark of spec.marks(values)) {
      if (!(mark.x >= a && mark.x <= b)) continue;
      layer.append(
        svgEl("line", { class: "rc-mark", x1: sx(mark.x), x2: sx(mark.x), y1: M.t, y2: H - M.b }),
        svgEl("text", {
          class: "rc-mark-label",
          x: sx(mark.x) + 3,
          y: M.t - 3,
          "text-anchor": sx(mark.x) > W - 60 ? "end" : "start",
          text: mark.label,
        }),
      );
    }
    const path = (pts) =>
      pts
        .filter(([, y]) => Number.isFinite(y))
        .map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`)
        .join("");
    if (ref) layer.append(svgEl("path", { class: "rc-line base", d: path(ref) }));
    layer.append(svgEl("path", { class: "rc-line now", d: path(now) }));

    legend.hidden = !ref;
    reset.hidden = !ref;
  }

  // 十字线吸附到指针所在的横坐标：读者瞄的是一个误差值，不是那根 2px 的线。
  const showAt = (event) => {
    if (!scales) return;
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const { sx, sy, a, b } = scales;
    const x = Math.min(b, Math.max(a, a + ((px - M.l) / (W - M.l - M.r)) * (b - a)));
    const y = spec.f(x, values);
    hover.setAttribute("visibility", "visible");
    hover.firstChild.setAttribute("x1", sx(x));
    hover.firstChild.setAttribute("x2", sx(x));
    hover.lastChild.setAttribute("cx", sx(x));
    hover.lastChild.setAttribute("cy", sy(y));
    const parts = [`横轴 ${fmt(x)}${spec.unit ? ` ${spec.unit}` : ""} → r = ${fmt(y)}`];
    if (changed()) parts.push(`数据值下 r = ${fmt(spec.f(x, base))}`);
    readout.textContent = parts.join("　·　");
  };
  hit.addEventListener("pointermove", showAt);
  hit.addEventListener("pointerdown", showAt);
  hit.addEventListener("pointerleave", () => {
    hover.setAttribute("visibility", "hidden");
    readout.textContent = idleText();
  });
  const idleText = () => "把指针移到图上读数。";

  const rows = spec.params.map((p) => {
    const id = `rc-${(uid += 1)}`;
    const input = el("input", {
      id,
      type: "range",
      min: 0,
      max: STEPS,
      step: 1,
      value: toSlider(p, p.value),
    });
    const out = el("output", { for: id, class: "rc-val", text: fmt(p.value) });
    const sym = el("span", { class: "rc-sym" });
    queueMath(sym, p.tex);
    input.addEventListener("input", () => {
      values[p.id] = fromSlider(p, Number(input.value));
      out.textContent = fmt(values[p.id]);
      draw();
    });
    const row = el("div", { class: "rc-param" }, [
      el("label", { for: id, class: "rc-name" }, [
        sym,
        // 键名就是符号本身（params 里写的是「σ」）时不再重复一遍。
        p.key && p.key !== p.id
          ? el("code", { text: p.key })
          : p.key
            ? null
            : el("span", { class: "rc-src", text: p.held ? (p.label ?? "固定") : "公式常数" }),
      ]),
      input,
      out,
      el("span", {
        class: "rc-base",
        text: p.held ? `默认 ${fmt(p.value)}` : `数据值 ${fmt(p.value)}`,
        title: p.held
          ? "这个量不是配置参数，是为了画成一维曲线而固定住的另一个量"
          : p.key
            ? `params.${p.key}`
            : "公式里写死的常数",
      }),
    ]);
    row.sync = () => {
      input.value = toSlider(p, values[p.id]);
      out.textContent = fmt(values[p.id]);
    };
    return row;
  });

  const weight = `纵轴是公式本身的值，进总奖励前还要乘权重 w = ${fmt(reward.weight)}。`;
  root.append(
    ...[
      svg,
      el("div", { class: "rc-axis" }, [el("span", { class: "rc-axis-name", text: "横轴" }), xLabel]),
      readout,
      legend,
      rows.length ? el("div", { class: "rc-params" }, rows) : null,
      reset,
      el("p", { class: "rc-note", text: [weight, ...spec.notes].join("") }),
    ].filter(Boolean),
  );
  readout.textContent = idleText();
  draw();
  return root;
}
