/**
 * 把数据里手写的可读表达式翻成 TeX，交给 KaTeX 排。
 *
 * 数据文件里除了奖励项的 `form` 之外，其余字段存的都是给人直接读的纯文本
 * （`(29 + 29) × 10 帧`、`U(−0.05, 0.05)`、`σ = 0.3`），不是 TeX。这一层只做
 * 「看得懂就翻，看不懂就交还原文」：任何一处拿不准都返回 null，由调用方按原样
 * 摆成等宽文本——宁可少排一格，也不要把一句说明文字硬掰成公式。
 */

/** 数据里用可读的 Unicode 符号，排版时换成正规写法。 */
const SYMBOL_TEX = {
  α: "\\alpha",
  β: "\\beta",
  γ: "\\gamma",
  δ: "\\delta",
  ε: "\\epsilon",
  θ: "\\theta",
  λ: "\\lambda",
  μ: "\\mu",
  π: "\\pi",
  σ: "\\sigma",
  τ: "\\tau",
  φ: "\\phi",
  ω: "\\omega",
  Δ: "\\Delta",
  Σ: "\\Sigma",
  Ω: "\\Omega",
};

/**
 * 运算符与括号。注意「·」不在表里：本项目的数据用它作并列分隔符
 * （`10 帧 · 0.3 s · 去偏航`），不是乘号，翻成 \cdot 会读错。
 * 全角括号同理不算括号，留在文字里按原样排。
 */
const OPERATOR_TEX = {
  "+": "+",
  "-": "-",
  "−": "-",
  "×": "\\times",
  "*": "\\times",
  "/": "/",
  "=": "=",
  ",": ",",
  "(": "(",
  ")": ")",
};

/** 只有这几个才算「这串东西是表达式」的证据，逗号和括号不算。 */
const REAL_OPERATORS = new Set(["+", "-", "−", "×", "*", "/", "="]);

const TEXT_ESCAPE = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  $: "\\$",
  "&": "\\&",
  "#": "\\#",
  "^": "\\textasciicircum{}",
  _: "\\_",
  "~": "\\textasciitilde{}",
  "%": "\\%",
};

const NUMBER_RE = /^\d+(?:\.\d+)?/;
const WORD_RE = /^[^\s+\-−×*/=,()]+/;

function textTex(word) {
  if (SYMBOL_TEX[word]) return SYMBOL_TEX[word];
  return `\\text{${word.replace(/[\\{}$&#^_~%]/g, (c) => TEXT_ESCAPE[c])}}`;
}

/** 切成「量」和「运算符」两种记号；括号不配对就直接放弃。 */
function tokenize(text) {
  const tokens = [];
  let rest = text.trim();
  let depth = 0;
  while (rest) {
    const space = /^\s+/.exec(rest);
    if (space) {
      rest = rest.slice(space[0].length);
      continue;
    }
    const number = NUMBER_RE.exec(rest);
    if (number) {
      tokens.push({ kind: "atom", tex: number[0] });
      rest = rest.slice(number[0].length);
      continue;
    }
    const char = rest[0];
    if (OPERATOR_TEX[char] !== undefined) {
      if (char === "(") depth += 1;
      if (char === ")") {
        depth -= 1;
        if (depth < 0) return null;
      }
      tokens.push({ kind: "op", char, tex: OPERATOR_TEX[char] });
      rest = rest.slice(1);
      continue;
    }
    const word = WORD_RE.exec(rest);
    if (!word) return null;
    tokens.push({ kind: "atom", tex: textTex(word[0]) });
    rest = rest.slice(word[0].length);
  }
  return depth === 0 ? tokens : null;
}

/**
 * 可读表达式 → TeX。看不出是表达式（没有数字、没有运算符），或者结构上排不出来
 * （括号不配对、末尾吊着一个运算符）时返回 null。
 */
export function exprTex(text) {
  if (typeof text !== "string" || !/\d/.test(text)) return null;
  const tokens = tokenize(text);
  if (!tokens?.length) return null;
  if (!tokens.some((t) => t.kind === "op" && REAL_OPERATORS.has(t.char))) return null;

  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  // 「1 +」这种半截式子 KaTeX 会报错；开头只允许正负号和左括号。
  if (last.kind === "op" && last.char !== ")") return null;
  if (first.kind === "op" && !["(", "+", "-", "−"].includes(first.char)) return null;

  return tokens
    .map((token, i) => {
      // 两个「量」挨在一起（`10 帧`）要自己补空隙；运算符两侧 KaTeX 按数学间距排。
      const gap = i && tokens[i - 1].kind === "atom" && token.kind === "atom" ? "\\," : "";
      return gap + token.tex;
    })
    .join("");
}

/** 训练噪声写作 `U(a, b)`，指的是均匀分布，按惯例排成花体 U。 */
export function noiseTex(text) {
  const uniform = /^U\s*\((.+)\)$/.exec(String(text).trim());
  if (!uniform) return exprTex(text);
  const inner = exprTex(uniform[1]);
  return inner && `\\mathcal{U}\\left(${inner}\\right)`;
}

/**
 * 数值 → TeX。小于 0.01 的走科学计数法：feet_acc 的 -2.5e-6 直接 String() 出来
 * 是 -0.0000025，一列数字里最扎眼的一格反而最难读。
 */
export function numberTex(value) {
  if (!Number.isFinite(value)) return null;
  if (value === 0) return "0";
  if (Math.abs(value) >= 0.01) return String(value);
  const [mantissa, exponent] = value.toExponential().split("e");
  return `${mantissa}\\times10^{${Number(exponent)}}`;
}
