/**
 * 奖励公式 → 可画的一维曲线。
 *
 * 数据里每个奖励项的 `form` 是给 KaTeX 排版的 TeX，`params` 是配置里的数值。
 * 这里认得几类固定写法（高斯核、exp(−s·误差)、阈值阶跃、死区平方、饱和斜坡、
 * 判别器的 −log(1 − D)……），把它翻成「横轴是哪个量、纵轴怎么算、哪些参数能调」。
 *
 * 原则与 mathtext.js、index-map.js 一样：认不出的写法就不画，绝不按名字去猜一个函数。
 * 曲线里的每个常数要么来自 `params`，要么就是 `form` 里写死的那个数；横轴取哪个量、
 * 多元公式里其余的量固定在几，这些是为了画成一维而做的取舍，会通过 `notes` 原样
 * 交给页面写给读者。
 *
 * 纯数据模块，不碰 DOM：页面与 scripts/validate.mjs 共用，校验脚本会对每个能画的
 * 奖励项在整个横轴上求值，确认曲线没有 NaN。
 */

import { compile, identifiers, parseExpr } from "./curve-expr.js";

/** 去掉只管排版的记号（\left \right \! \, …），压缩空白，匹配时不必再管它们。 */
function norm(form) {
  return form
    .replace(/\\left|\\right|\\bigl|\\bigr|\\!|\\,|\\ /g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "1.0 N"、"全部关节 15.0"、"1/60 s"、"全 1" → 数字；读不出返回 null。 */
export function numberOf(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const frac = value.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const m = value.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/i);
  return m ? Number(m[0]) : null;
}

/** 按候选键在 params 里找第一个能读成数字的值。 */
function pick(params, keys) {
  for (const key of keys) {
    const v = numberOf(params?.[key]);
    if (v != null) return { key, value: v };
  }
  return null;
}

/** 键名里带 scale 的第一个数值参数：λ 在数据里叫 disc_reward_scale / sds_loss_scale。 */
function pickScale(params) {
  const key = Object.keys(params ?? {}).find((k) => /scale/i.test(k) && numberOf(params[k]) != null);
  return key ? { key, value: numberOf(params[key]) } : null;
}

/**
 * 一个可调参数。value 来自 params（key 是数据里的键名）或公式里写死的常数（key 为 null）。
 * scale 型参数（σ、s、λ）在对数尺度上滑，范围是数据值的 1/4 ~ 4 倍：跨度够看出形状怎么变，
 * 又不至于把曲线推出画面。
 */
function param(id, tex, found, fallback, range) {
  const value = found?.value ?? fallback;
  const base = {
    id,
    tex,
    key: found?.key ?? null,
    value,
    log: false,
  };
  if (range === "scale") return { ...base, min: value / 4, max: value * 4, log: true };
  return { ...base, min: range[0], max: range[1] };
}

/** 多元公式里为了画成一维而固定住的那个量，读者也能拖。int 为真时只取整数（如「偏了几个关节」）。 */
function held(id, tex, range, value = 0, { int = false, label = null } = {}) {
  return { id, tex, key: null, value, min: range[0], max: range[1], log: false, held: true, int, label };
}

/** 求和下标：_j、_{f}、_{b \in \mathcal{B}}。 */
const SUB = String.raw`_(?:\{(?:[^{}]|\{[^{}]*\})*\}|\w)`;

const wrapPi = (x) => Math.atan2(Math.sin(x), Math.cos(x));

/** 横轴范围只是示意（公式里没有参数能定出尺度）时附的说明。 */
const NOTE_SKETCH = "这一项没有可调参数定尺度，横轴范围只是示意。";

/**
 * 每一类写法：match 认出来就返回曲线规格。
 * 规格字段：
 *   xTex      横轴是哪个量（TeX）
 *   x         [起, 止]
 *   params    可调参数与固定量（见 param / held）
 *   f(x, v)   纵轴；v 是 { 参数 id: 当前值 }
 *   marks(v)  竖向参考线 [{ x, label }]，跟着参数走（σ、阈值）
 *   notes     画成一维所做的取舍，原样展示
 */
const FAMILIES = [
  {
    // 高斯核：exp(−e²/σ²)。BeyondMimic、SONIC 的跟踪项。
    id: "gauss",
    match(f, params) {
      const m = f.match(/^\\exp\(-(.+)\/\\sigma\^\{2\}\)$/);
      if (!m) return null;
      const mean = m[1].match(/^\\overline\{(.+)\^\{2\}\}$/);
      const plain = m[1].match(/^(.+)\^\{2\}$/);
      // 括号里是几项平方和（微鸭的速度跟踪：xy 误差 + 不该有的 z 分量）。
      const sum = !mean && !plain ? m[1].match(/^\((.+\^\{2\}\s*\+\s*.+\^\{2\})\)$/) : null;
      if (!mean && !plain && !sum) return null;
      const sigma = param("σ", "\\sigma", pick(params, ["σ", "sigma", "std"]), null, "scale");
      if (sigma.value == null) return null;
      return {
        xTex: mean ? `\\sqrt{\\overline{${mean[1]}^{2}}}` : sum ? `\\sqrt{${sum[1]}}` : plain[1],
        x: [0, 3 * sigma.value],
        params: [sigma],
        f: (x, v) => Math.exp(-(x * x) / (v.σ * v.σ)),
        marks: (v) => [{ x: v.σ, label: "σ" }],
        notes: [
          mean ? "公式里是各连杆平方误差的均值；横轴取它的平方根，于是曲线仍是一条高斯钟形。" : null,
          sum ? "指数里是几项误差的平方和；横轴取它的平方根（合成误差），于是曲线仍是一条高斯钟形。" : null,
          "误差等于 σ 时奖励掉到 e⁻¹ ≈ 0.37：σ 就是「多大的误差算跟丢了一半」。",
        ],
      };
    },
  },
  {
    // exp(−s·Σ…)：MimicKit DeepMimic 的跟踪项，尺度系数叫 scale。
    id: "exp-scale",
    match(f, params) {
      const m = f.match(/^\\exp\(-s\s*(.+)\)$/);
      if (!m) return null;
      const s = param("s", "s", pick(params, ["scale", "s"]), null, "scale");
      if (s.value == null) return null;
      const width = 3 / Math.sqrt(s.value);
      const two = m[1].match(/^\((.+?)\^\{2\}\s*\+\s*([\d.]+)\s*(.+)\^\{2\}\)$/);
      if (two) {
        const c = Number(two[2]);
        const angle = /\\theta/.test(two[3]);
        const h = held("h", two[3], [0, angle ? Math.PI : width / Math.sqrt(c)]);
        return {
          xTex: two[1],
          x: [0, width],
          params: [s, h],
          f: (x, v) => Math.exp(-v.s * (x * x + c * v.h * v.h)),
          marks: (v) => [{ x: 1 / Math.sqrt(v.s), label: "1/√s" }],
          notes: [
            `公式里有两个误差；横轴取第一个，第二个（系数 ${c}）用下面的滑块固定，默认为 0。`,
            "误差等于 1/√s 时奖励掉到 e⁻¹ ≈ 0.37。",
          ],
        };
      }
      return {
        xTex: `\\sqrt{${m[1]}}`,
        x: [0, width],
        params: [s],
        f: (x, v) => Math.exp(-v.s * x * x),
        marks: (v) => [{ x: 1 / Math.sqrt(v.s), label: "1/√s" }],
        notes: [
          "横轴取指数里那一项（加权平方和）的平方根，于是曲线是一条钟形；误差等于 1/√s 时奖励掉到 e⁻¹ ≈ 0.37。",
        ],
      };
    },
  },
  {
    // exp(−λ·L)：SMP 的扩散先验，L 是 SDS 损失本身（不平方）。
    id: "exp-lambda",
    match(f, params) {
      const m = f.match(/^\\exp\(-\\lambda\s*(.+)\)$/);
      if (!m) return null;
      const lambda = param("λ", "\\lambda", pickScale(params), null, "scale");
      if (lambda.value == null) return null;
      return {
        xTex: m[1],
        x: [0, 3 / lambda.value],
        params: [lambda],
        f: (x, v) => Math.exp(-v.λ * x),
        marks: (v) => [{ x: 1 / v.λ, label: "1/λ" }],
        notes: ["损失等于 1/λ 时奖励掉到 e⁻¹ ≈ 0.37。"],
      };
    },
  },
  {
    // λ·(−log(1 − D))：AMP / ASE / ADD 的判别器奖励。
    id: "disc",
    match(f, params) {
      const m = f.match(/^\\lambda\s*\(-\\log\(1\s*-\s*(.+)\)\)$/);
      if (!m) return null;
      const lambda = param("λ", "\\lambda", pickScale(params), null, "scale");
      if (lambda.value == null) return null;
      return {
        xTex: m[1],
        x: [0, 0.99],
        params: [lambda],
        f: (x, v) => -v.λ * Math.log(1 - x),
        marks: () => [{ x: 0.5, label: "D = 0.5" }],
        notes: [
          "横轴是判别器给出的「像参考动作」的概率。D = 0.5 是判别器分不出真假；越往右奖励涨得越快，D → 1 时发散，横轴画到 0.99 为止。",
        ],
      };
    },
  },
  {
    // max(z·ẑ, 0)：ASE 的编码器奖励。
    id: "relu",
    match(f) {
      const m = f.match(/^\\max\((.+?),\s*0\)$/);
      if (!m) return null;
      return {
        xTex: m[1],
        x: [-1, 1],
        params: [],
        f: (x) => Math.max(x, 0),
        marks: () => [],
        notes: ["z 与 ẑ 都在单位球面上，点积落在 [−1, 1]；方向相反时不罚，只是不给分。"],
      };
    },
  },
  {
    // SMP 的躲避任务：pos_w(1 − e^{−pos_scale·d}) + vel_w·e^{−vel_scale·v²}。
    id: "dodge",
    match(f, params) {
      const m = f.match(
        /^([\d.]+)\s*\(1\s*-\s*e\^\{-([\d.]+)\s*(.+?)\}\)\s*\+\s*([\d.]+)\s*e\^\{-(.+)\^\{2\}\}$/,
      );
      if (!m) return null;
      const pw = param("pw", "w_{\\text{pos}}", pick(params, ["pos_w"]), Number(m[1]), [0, 1]);
      const ps = param("ps", "s_{\\text{pos}}", pick(params, ["pos_scale"]), Number(m[2]), "scale");
      const vw = param("vw", "w_{\\text{vel}}", pick(params, ["vel_w"]), Number(m[4]), [0, 1]);
      const vs = param("vs", "s_{\\text{vel}}", pick(params, ["vel_scale"]), 1, "scale");
      const h = held("h", m[5], [0, 3]);
      return {
        xTex: m[3],
        x: [0, 3 / ps.value],
        params: [pw, ps, vw, vs, h],
        f: (x, v) => v.pw * (1 - Math.exp(-v.ps * x)) + v.vw * Math.exp(-v.vs * v.h * v.h),
        marks: () => [],
        notes: ["横轴取到投射物的最近距离；第二项的速度用滑块固定，默认为 0（站着不动时第二项拿满）。"],
      };
    },
  },
  {
    // k·min(h/阈值, 1)：Isaac Lab Ant 的朝向项。
    id: "ramp",
    match(f, params) {
      const m = f.match(/^(?:([\d.]+)\s*\\cdot\s*)?\\min\((.+?)\/([\d.]+),\s*1\)$/);
      if (!m) return null;
      const th = param("th", "\\text{threshold}", pick(params, ["threshold"]), Number(m[3]), [0.05, 1]);
      const list = [th];
      let k = { value: 1 };
      if (m[1]) {
        const key = Object.keys(params ?? {}).find(
          (q) => q !== "threshold" && numberOf(params[q]) === Number(m[1]),
        );
        k = param("k", "k", key ? { key, value: numberOf(params[key]) } : null, Number(m[1]), [0, 1]);
        list.unshift(k);
      }
      return {
        xTex: m[2],
        x: [-1, 1],
        params: list,
        f: (x, v) => (v.k ?? 1) * Math.min(x / v.th, 1),
        marks: (v) => [{ x: v.th, label: "阈值" }],
        notes: ["投影值超过阈值后奖励封顶：朝向「差不多对准」就拿满，不必分毫不差。"],
      };
    },
  },
  {
    // Σ 1[|q̃| > 阈值]·(|q̃| − 阈值)/(1 − 阈值)·g̃：Ant 的关节限位惩罚。
    id: "limit-ramp",
    match(f, params) {
      const m = f.match(
        /^\\sum_\{i=1\}\^\{\d+\}\s*\\mathbb\{1\}\[(\\lvert.+?\\rvert)\s*>\s*([\d.]+)\]\s*\\cdot\s*\\frac\{.+\}\{.+\}\s*\\cdot\s*(\\tilde g_i)$/,
      );
      if (!m) return null;
      const th = param("th", "\\text{threshold}", pick(params, ["threshold"]), Number(m[2]), [0.9, 0.999]);
      const g = param("g", "\\tilde g", pick(params, ["gear_ratio"]), 1, [1, 30]);
      return {
        xTex: m[1],
        x: [0.9, 1],
        params: [th, g],
        f: (x, v) => (x > v.th ? ((x - v.th) / (1 - v.th)) * v.g : 0),
        marks: (v) => [{ x: v.th, label: "阈值" }],
        notes: ["画的是单个关节的贡献；横轴是按限位归一化的关节位置，1 就是撞到限位。"],
      };
    },
  },
  {
    // (1/n) Σ exp(−e_j²/σ²)：微鸭的头姿跟踪，每个关节各过一个高斯核再取均值。
    id: "mean-gauss",
    match(f, params) {
      const m = f.match(
        /^\\frac\{1\}\{(\d+)\}\\sum_\{j=1\}\^\{\d+\}\s*\\exp\(-(.+?)\^\{2\}\/\\sigma\^\{2\}\)$/,
      );
      if (!m) return null;
      const n = Number(m[1]);
      const sigma = param("σ", "\\sigma", pick(params, ["σ", "sigma", "std"]), null, "scale");
      if (sigma.value == null) return null;
      const k = held("k", "k", [1, n], n, { int: true, label: "偏了几个关节" });
      return {
        xTex: m[2],
        x: [0, 3 * sigma.value],
        params: [sigma, k],
        f: (x, v) => (n - v.k + v.k * Math.exp(-(x * x) / (v.σ * v.σ))) / n,
        marks: (v) => [{ x: v.σ, label: "σ" }],
        notes: [
          `横轴是单个关节的误差 e；k 个关节都偏 e、其余关节跟得上时奖励是 (${n} − k + k·exp(−e²/σ²))/${n}，默认 k = ${n}（全部偏）。拖小 k 能看到「只偏一个关节，只少拿一部分」。`,
        ],
      };
    },
  },
  {
    // exp(−(1/N) Σ e_j²/σ_j²)：mjlab 的 variable_posture，每个关节一个 σ。
    id: "posture",
    match(f, params) {
      if (!/^\\exp\(-\\frac\{1\}\{N\}\\sum_\{?j\}?\s*e_j\^\{2\}\/\\sigma_j\^\{2\}\)$/.test(f)) return null;
      const keys = Object.keys(params ?? {}).filter((k) => /^σ_/.test(k) && numberOf(params[k]) != null);
      if (!keys.length) return null;
      const sigmas = keys.map((key) =>
        param(
          key,
          `\\sigma_{\\text{${key.slice(2).replace(/_/g, "\\_")}}}`,
          { key, value: numberOf(params[key]) },
          null,
          "scale",
        ),
      );
      const widest = Math.max(...sigmas.map((p) => p.value));
      return {
        xTex: "e",
        x: [0, 1.5 * widest],
        params: sigmas,
        f: (x, v) => Math.exp(-keys.reduce((sum, key) => sum + (x * x) / (v[key] * v[key]), 0) / keys.length),
        marks: () => [],
        notes: [
          "横轴取所有关节同时偏同一个角度 e（rad）：每类关节左右各一个，对各类取均值就是对全部关节取均值。σ 最小的那类关节主导曲线下降得多快，拖它最明显。",
        ],
      };
    },
  },
  {
    // Σ 1[t_min < t < t_max]·1[‖c‖ > 阈值]：mjlab 的 feet_air_time，奖励落在窗口里的腾空时长。
    id: "window",
    match(f, params) {
      const m = f.match(
        new RegExp(
          String.raw`^\\sum${SUB}\s*\\mathbb\{1\}\[t_\{\\min\}\s*<\s*([^\[\]]+?)\s*<\s*t_\{\\max\}\]\s*\\cdot\s*\\mathbb\{1\}\[[^\[\]]+\]$`,
        ),
      );
      if (!m) return null;
      const lo = param("lo", "t_{\\min}", pick(params, ["threshold_min", "t_min"]), null, [0, 0.5]);
      const hi = param("hi", "t_{\\max}", pick(params, ["threshold_max", "t_max"]), null, [0, 1]);
      if (lo.value == null || hi.value == null) return null;
      return {
        xTex: m[1],
        x: [0, Math.max(0.5, 1.5 * hi.value)],
        unit: "s",
        params: [lo, hi],
        f: (x, v) => (x > v.lo && x < v.hi ? 1 : 0),
        marks: (v) => [
          { x: v.lo, label: "t_min" },
          { x: v.hi, label: "t_max" },
        ],
        notes: [
          "画的是单只脚、指令非零时的值：腾空时长落进窗口就拿 1，太短（拖步）或太长（单腿跳太久）都不给。",
        ],
      };
    },
  },
  {
    // Σ |h − h*|·‖v‖·1[…]：mjlab 的 feet_clearance，按足端水平速度加权的离地高度偏差。
    id: "clearance",
    match(f, params) {
      const m = f.match(
        new RegExp(
          String.raw`^\\sum${SUB}\s*\\lvert\s*(.+?)\s*-\s*h\^\{\*\}\s*\\rvert\s*\\cdot\s*(\\lVert.+?\\rVert)\s*\\cdot\s*\\mathbb\{1\}\[[^\[\]]+\]$`,
        ),
      );
      if (!m) return null;
      const target = param("h", "h^{*}", pick(params, ["target_height"]), null, "scale");
      if (target.value == null) return null;
      const v = held("v", m[2], [0, 1], 0.5, { label: "固定" });
      return {
        xTex: m[1],
        x: [0, 3 * target.value],
        unit: "m",
        params: [target, v],
        f: (x, p) => Math.abs(x - p.h) * p.v,
        marks: (p) => [{ x: p.h, label: "h*" }],
        notes: [
          "画的是单只脚、指令非零时的值；足端水平速度用滑块固定（默认 0.5 m/s 只为看形状），速度为 0 时这一项不管脚抬多高。",
        ],
      };
    },
  },
  {
    // Σ (h_peak/h* − 1)²·1[落地]·1[…]：mjlab 的 feet_swing_height，落地那一步结算。
    id: "swing",
    match(f, params) {
      const m = f.match(
        new RegExp(
          String.raw`^\\sum${SUB}\s*\((.+?)\/h\^\{\*\}\s*-\s*1\)\^\{2\}\s*\\cdot\s*\\mathbb\{1\}\[[^\[\]]+\]\s*\\cdot\s*\\mathbb\{1\}\[[^\[\]]+\]$`,
        ),
      );
      if (!m) return null;
      const target = param("h", "h^{*}", pick(params, ["target_height"]), null, "scale");
      if (target.value == null) return null;
      return {
        xTex: m[1],
        x: [0, 3 * target.value],
        unit: "m",
        params: [target],
        f: (x, v) => (x / v.h - 1) ** 2,
        marks: (v) => [{ x: v.h, label: "h*" }],
        notes: ["画的是单只脚落地那一步的值：按目标高度归一化，抬到一半和抬到 1.5 倍罚得一样多。"],
      };
    },
  },
  {
    // Σ ‖v‖²·1[着地]·1[…]：mjlab 的 feet_slip。
    id: "gated-sq",
    match(f) {
      const m = f.match(
        new RegExp(
          String.raw`^\\sum${SUB}\s*(\\lVert.+?\\rVert)\^\{2\}\s*\\cdot\s*\\mathbb\{1\}\[[^\[\]]+\]\s*\\cdot\s*\\mathbb\{1\}\[[^\[\]]+\]$`,
        ),
      );
      if (!m) return null;
      return {
        xTex: m[1],
        x: [0, 0.5],
        unit: "m/s",
        params: [],
        f: (x) => x * x,
        marks: () => [],
        notes: ["画的是单只着地的脚、指令非零时的值。", NOTE_SKETCH],
      };
    },
  },
  {
    // −(1/n) Σ |EMA(e_j)|：微鸭的头姿直流偏置。稳态下滑动平均就是那个常值误差本身。
    id: "neg-abs-mean",
    match(f) {
      const m = f.match(/^-\\frac\{1\}\{(\d+)\}\\sum_\{j=1\}\^\{\d+\}\s*\\lvert(.+)\\rvert$/);
      if (!m) return null;
      const n = Number(m[1]);
      const k = held("k", "k", [1, n], n, { int: true, label: "偏了几个关节" });
      // 带滑动平均的（头姿直流偏置）横轴是稳态偏置；不带的就是误差本身。
      const ema = /EMA/.test(m[2]);
      const sym = ema ? "b" : "e";
      return {
        xTex: sym,
        x: [-0.3, 0.3],
        unit: "rad",
        params: [k],
        f: (x, v) => -(v.k * Math.abs(x)) / n,
        marks: () => [{ x: 0, label: "0" }],
        notes: [
          ema ? "横轴 b 是稳态偏置：误差长期停在 b 时，滑动平均就等于 b。" : "横轴 e 是单个关节的误差。",
          `k 个关节都偏 ${sym} 时值为 −k·|${sym}|/${n}。L1：偏多少罚多少，偏差大时梯度不会消失。`,
        ],
      };
    },
  },
  {
    // Σ [(q_lo − q)₊ + (q − q_hi)₊]：mjlab 的 joint_pos_limits，两侧 L1。
    id: "limits-l1",
    match(f) {
      const m = f.match(
        new RegExp(String.raw`^\\sum${SUB}\s*\[\((.+?)-(.+?)\)_\{\+\}\s*\+\s*\((.+?)-(.+?)\)_\{\+\}\]$`),
      );
      if (!m) return null;
      return {
        xTex: m[2],
        x: [-1.5, 1.5],
        params: [],
        f: (x) => Math.max(0, -1 - x) + Math.max(0, x - 1),
        marks: () => [
          { x: -1, label: "下限" },
          { x: 1, label: "上限" },
        ],
        notes: [
          "画的是单个关节；横轴按软限位归一化（下限 −1、上限 1），限位内一分不罚，越出去按距离线性罚。",
          NOTE_SKETCH,
        ],
      };
    },
  },
  {
    // ±Σ 1[x > 阈值]：直立、关节贴限位、非期望接触。
    id: "step",
    match(f, params) {
      const m = f.match(
        /^(-)?\s*(\\sum_(?:\{(?:[^{}]|\{[^{}]*\})*\}|\w)(?:\^\{\d+\})?\s*)?\\mathbb\{1\}\[([^\[\]]+?)\s*>\s*([\d.]+)\s*(?:\\mathrm\{(\w+)\})?\]$/,
      );
      if (!m) return null;
      const fallback = Number(m[4]);
      const unit = m[5] ?? "";
      const range = fallback < 1 ? [0, 1] : [0, 3 * fallback];
      const th = param("th", "\\text{threshold}", pick(params, ["threshold", "阈值"]), fallback, [
        range[0],
        range[1] * 0.98,
      ]);
      const sign = m[1] ? -1 : 1;
      return {
        xTex: m[3],
        x: range,
        unit,
        params: [th],
        f: (x, v) => sign * (x > v.th ? 1 : 0),
        marks: (v) => [{ x: v.th, label: "阈值" }],
        notes: [m[2] ? "画的是求和里单独一项（一个连杆 / 一个关节）的贡献，总奖励按个数累加。" : null],
      };
    },
  },
  {
    // −Σ max(0, x − 阈值)²：SONIC 的防抖项。
    id: "deadzone",
    match(f, params) {
      // 符号可正可负（Isaac Lab 习惯是正值函数 × 负权重），也可以是均值 \\frac{1}{n}\\sum。
      const m = f.match(
        new RegExp(String.raw`^(-)?\s*(?:\\frac\{1\}\{(\d+)\}\s*)?\\sum${SUB}\s*\\max\(0,\s*(.+?)-([\d.]+)\)\^\{2\}$`),
      );
      if (!m) return null;
      const sign = m[1] ? -1 : 1;
      const n = m[2] ? Number(m[2]) : null;
      const fallback = Number(m[4]);
      const th = param("th", "\\text{threshold}", pick(params, ["threshold", "阈值"]), fallback, [
        0,
        2 * fallback,
      ]);
      return {
        xTex: m[3],
        x: [0, 2.5 * fallback],
        params: [th],
        f: (x, v) => sign * Math.max(0, x - v.th) ** 2,
        marks: (v) => [{ x: v.th, label: "阈值" }],
        notes: [
          n
            ? `公式对 ${n} 个连杆取均值：${n} 个连杆都是这个值时就等于这条曲线，只有一个超阈值时是它的 1/${n}。`
            : "画的是单个连杆的贡献。",
          "阈值以内完全不罚，超出部分按平方算。",
        ],
      };
    },
  },
  {
    // (wrap_π(θ) − 目标)²：Isaac Lab 倒立摆 manager 版的摆角项。
    id: "wrap-quad",
    match(f, params) {
      const m = f.match(/^\(\\operatorname\{wrap\}_\{\\pi\}\((.+?)\)\s*-\s*([-\d.]+)\)\^\{2\}$/);
      if (!m) return null;
      const target = param("t", "\\text{target}", pick(params, ["target"]), Number(m[2]), [
        -Math.PI,
        Math.PI,
      ]);
      return {
        xTex: m[1],
        x: [-2 * Math.PI, 2 * Math.PI],
        params: [target],
        f: (x, v) => (wrapPi(x) - v.t) ** 2,
        marks: (v) => [{ x: v.t, label: "目标" }],
        notes: ["角度先折回 [−π, π] 再算平方，所以每转一整圈曲线重复一次。"],
      };
    },
  },
  {
    // Σ a_i² = ‖a‖²：动作幅度惩罚。
    id: "sum-sq",
    match(f) {
      const m = f.match(/^\\sum_\{i=1\}\^\{\d+\}\s*(\w)_i\^\{2\}$/);
      if (!m) return null;
      return {
        xTex: `\\lVert ${m[1]}\\rVert`,
        x: [0, 2],
        params: [],
        f: (x) => x * x,
        marks: () => [],
        notes: ["各分量平方和就是向量长度的平方。", NOTE_SKETCH],
      };
    },
  },
  {
    // ±‖x‖²：动作变化率、踝关节加速度、躯干角速度、角动量。
    id: "norm-sq",
    match(f) {
      const m = f.match(/^(-)?(\\lVert.+\\rVert)\^\{2\}$/);
      if (!m) return null;
      const sign = m[1] ? -1 : 1;
      return {
        xTex: m[2],
        x: [0, 1],
        params: [],
        f: (x) => sign * x * x,
        marks: () => [],
        notes: [NOTE_SKETCH],
      };
    },
  },
  {
    // θ²：倒立摆 direct 版的摆角项。
    id: "quad",
    match(f) {
      const m = f.match(/^(\\?\w+)\^\{2\}$/);
      if (!m) return null;
      const angle = /theta/.test(m[1]);
      return {
        xTex: m[1],
        x: angle ? [-Math.PI, Math.PI] : [-1, 1],
        params: [],
        f: (x) => x * x,
        marks: () => [],
        notes: angle ? ["这一版不折角：摆杆转过整圈后惩罚继续变大。"] : [NOTE_SKETCH],
      };
    },
  },
  {
    // |x|：倒立摆的速度项。
    id: "abs",
    match(f) {
      const m = f.match(/^\\lvert(.+)\\rvert$/);
      if (!m || /\\lvert/.test(m[1])) return null;
      return {
        xTex: m[1],
        x: [-2, 2],
        params: [],
        f: (x) => Math.abs(x),
        marks: () => [],
        notes: [NOTE_SKETCH],
      };
    },
  },
  {
    // Σ |a_i q̇_i g̃_i| / Σ |a_i q̇_i · k| · r_i：Ant 的能耗项，对单个关节的 |a·q̇| 是一条直线。
    id: "power",
    match(f, params) {
      let m = f.match(/^\\sum_\{i=1\}\^\{\d+\}\s*\\lvert a_i\s*\\dot q_i\s*\\tilde g_i\\rvert$/);
      if (m) {
        const g = param("g", "\\tilde g", pick(params, ["gear_ratio"]), 1, [1, 30]);
        return {
          xTex: "\\lvert a_i\\dot q_i\\rvert",
          x: [0, 1],
          params: [g],
          f: (x, v) => v.g * x,
          marks: () => [],
          notes: ["画的是单个关节的贡献：对 |a·q̇| 是一条斜率为 g̃ 的直线。", NOTE_SKETCH],
        };
      }
      m = f.match(
        /^\\sum_\{i=1\}\^\{\d+\}\s*\\lvert a_i\s*\\dot q_i\s*\\cdot\s*([\d.]+)\\rvert\s*\\cdot\s*r_i$/,
      );
      if (!m) return null;
      const k = param("k", "k", pick(params, ["dof_vel_scale"]), Number(m[1]), [0, 1]);
      const r = param("r", "r_i", pick(params, ["motor_effort_ratio"]), 1, [0, 2]);
      return {
        xTex: "\\lvert a_i\\dot q_i\\rvert",
        x: [0, 1],
        params: [k, r],
        f: (x, v) => v.k * x * v.r,
        marks: () => [],
        notes: ["画的是单个关节的贡献：对 |a·q̇| 是一条直线，斜率是速度缩放 × 电机出力比。", NOTE_SKETCH],
      };
    },
  },
  {
    // (d_{t−1} − d_t)/Δt：Ant 的前进项，等于朝目标靠近的速度。
    id: "progress",
    match(f, params) {
      const m = f.match(/^\\frac\{(.+)\}\{(\\Delta t(?:_\{\\text\{sim\}\})?)\}$/);
      if (!m) return null;
      const dt = param("dt", m[2], pick(params, ["Δt", "Δt_sim", "dt"]), null, "scale");
      if (dt.value == null) return null;
      return {
        xTex: "\\Delta d",
        x: [-0.02, 0.02],
        params: [dt],
        f: (x, v) => x / v.dt,
        marks: () => [{ x: 0, label: "0" }],
        notes: ["横轴 Δd 是这一步离目标近了多少（米，负数是走远了）；除以 Δt 就是朝目标的速度。"],
      };
    },
  },
];

/** 没有自变量可画的写法：给一句话说明为什么没有曲线。 */
const NO_CURVE = [
  [/^1$/, "常数：每一步都给 1，没有自变量。"],
  [/^N_\{\\text\{[^}]+\}\}$/, "计数：这一步检测到的接触个数，没有连续自变量。"],
  [/^1?\s*-?\s*\\mathbb\{1\}\[\\text\{terminated\}\]$/, "只看这一步是否终止，取值 0 或 1，没有连续曲线。"],
];

/**
 * 数据里直接给出的曲线（reward.curve）。上游的奖励函数五花八门（平滑门控、几个因子相乘、
 * 带符号的限速……），为每一种写一条 TeX 模板既脆又把项目专属逻辑塞进了页面代码，
 * 所以允许数据自己写一行算式（语法见 curve-expr.js）。参数值一律从 reward.params[key]
 * 读，与公式旁列出的参数是同一份数字；curve 里只写「怎么画」，不另存数值。
 *
 *   curve: {
 *     x: { tex, range: [a, b], unit? },
 *     f: "算式，可用 x、参数 id、held id",
 *     params: [{ id, tex, key, range?, log? }],      // range 缺省时按数据值的 1/4 ~ 4 倍对数滑
 *     held:   [{ id, tex, range, value, int?, label? }],
 *     marks:  [{ x: "算式", label }],
 *     notes:  ["画成一维时做的取舍"]
 *   }
 */
export function dataCurve(reward) {
  const c = reward.curve;
  const params = (c.params ?? []).map((p) => {
    const value = numberOf(reward.params?.[p.key]);
    if (value == null) throw new Error(`curve 参数 ${p.id} 指向的 params.${p.key} 不是数字`);
    const range = p.range ?? (p.log === false ? null : "scale");
    if (!range) throw new Error(`curve 参数 ${p.id} 缺 range`);
    const built = param(p.id, p.tex ?? null, { key: p.key, value }, null, range);
    return p.range && p.log ? { ...built, log: true } : built;
  });
  const helds = (c.held ?? []).map((h) =>
    held(h.id, h.tex, h.range, h.value ?? h.range[0], { int: Boolean(h.int), label: h.label ?? null }),
  );
  const fn = compile(c.f);
  const marks = (c.marks ?? []).map((m) => ({ at: compile(String(m.x)), label: m.label }));
  return {
    kind: "curve",
    family: "data",
    xTex: c.x.tex,
    x: c.x.range,
    unit: c.x.unit ?? "",
    params: [...params, ...helds],
    f: (x, v) => fn({ ...v, x }),
    marks: (v) => marks.map((m) => ({ x: m.at(v), label: m.label })),
    notes: (c.notes ?? []).filter(Boolean),
  };
}

/** 数据曲线里用到、却没有定义的标识符（校验脚本用）。 */
export function undefinedInCurve(reward) {
  const c = reward.curve;
  const known = new Set(["x", ...(c.params ?? []).map((p) => p.id), ...(c.held ?? []).map((h) => h.id)]);
  const used = identifiers(parseExpr(c.f));
  for (const m of c.marks ?? []) identifiers(parseExpr(String(m.x)), used);
  return [...used].filter((id) => !known.has(id));
}

/**
 * @returns {null}                                  没有公式（数据只写了名字与权重）
 *          {{ kind: "none", reason: string }}      有公式但没有连续自变量
 *          {{ kind: "unknown" }}                    有公式、本模块认不出
 *          {{ kind: "curve", family, ...spec }}     能画
 */
export function curveFor(reward) {
  if (!reward?.form) return null;
  // 数据明说画不了（带记忆的 0 / 1 项、接触计数……）时直接用它的理由。
  if (reward.noCurve) return { kind: "none", reason: reward.noCurve };
  if (reward.curve) return dataCurve(reward);
  const f = norm(reward.form);
  for (const [re, reason] of NO_CURVE) if (re.test(f)) return { kind: "none", reason };
  for (const family of FAMILIES) {
    const spec = family.match(f, reward.params ?? {});
    if (spec) {
      return { kind: "curve", family: family.id, ...spec, notes: (spec.notes ?? []).filter(Boolean) };
    }
  }
  return { kind: "unknown" };
}

/** 参数 id → 数据值。 */
export function defaults(spec) {
  return Object.fromEntries(spec.params.map((p) => [p.id, p.value]));
}

/** 在横轴上均匀取 n + 1 个点。 */
export function sample(spec, values, n = 240) {
  const [a, b] = spec.x;
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const x = a + ((b - a) * i) / n;
    pts.push([x, spec.f(x, values)]);
  }
  return pts;
}
