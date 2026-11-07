/**
 * 奖励曲线的表达式：数据里 `curve.f` 写的一行算式，解析成语法树后求值。
 *
 * 为什么不用 Function()：表达式来自数据文件，求值器只认四则运算、乘方、比较和下面
 * 列出的几个数学函数，别的一概报错——数据写错了在校验脚本里就炸，不会变成任意代码。
 *
 * 语法：数字、标识符（x、参数 id、held id、pi）、+ - * / ^、一元负号、括号、
 * 比较 < <= > >=、逻辑 && ||（真为 1、假为 0）、条件 c ? a : b、函数调用。^ 右结合，优先级高于
 * 一元负号（-x^2 = -(x^2)）。
 */

const FUNCS = {
  exp: Math.exp,
  log: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tanh: Math.tanh,
  atan2: Math.atan2,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  /** clamp(v, lo, hi) */
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  /** (v)₊ */
  pos: (v) => Math.max(0, v),
  /** t²(3 − 2t)：已经夹到 [0, 1] 的平滑过渡（smoothstep 的后半段） */
  hermite: (t) => t * t * (3 - 2 * t),
  /** v > 0 时 1，否则 0 */
  step: (v) => (v > 0 ? 1 : 0),
  /** 与 GLSL 相同：t = clamp((v − e0)/(e1 − e0), 0, 1)，返回 t²(3 − 2t) */
  smoothstep: (e0, e1, v) => {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  },
  /** 弧度 ↔ 角度 */
  deg: (v) => (v * 180) / Math.PI,
  rad: (v) => (v * Math.PI) / 180,
};

const CONSTS = { pi: Math.PI };

/** 只认自己的键：「constructor」「__proto__」这类原型上的名字一律当作未定义。 */
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i += 1;
    } else if (/[0-9.]/.test(ch)) {
      const m = src.slice(i).match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
      if (!m) throw new Error(`表达式里有不认识的字符「${ch}」`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
    } else if (["<=", ">=", "&&", "||"].some((op) => src.startsWith(op, i))) {
      out.push({ t: "op", v: src.slice(i, i + 2) });
      i += 2;
    } else if ("+-*/^(),<>?:".includes(ch)) {
      out.push({ t: "op", v: ch });
      i += 1;
    } else {
      throw new Error(`表达式里有不认识的字符「${ch}」`);
    }
  }
  return out;
}

/** 递归下降：cond → or → and → cmp → add → mul → unary → pow → atom。 */
export function parseExpr(src) {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (v) => {
    const tok = tokens[pos];
    if (!tok || tok.v !== v) throw new Error(`表达式「${src}」在第 ${pos + 1} 个记号处缺「${v}」`);
    pos += 1;
  };

  function cond() {
    const test = or();
    if (peek() && peek().v === "?") {
      pos += 1;
      const yes = cond();
      eat(":");
      return { op: "?", c: test, a: yes, b: cond() };
    }
    return test;
  }
  function or() {
    let node = and();
    while (peek() && peek().v === "||") {
      pos += 1;
      node = { op: "||", a: node, b: and() };
    }
    return node;
  }
  function and() {
    let node = cmp();
    while (peek() && peek().v === "&&") {
      pos += 1;
      node = { op: "&&", a: node, b: cmp() };
    }
    return node;
  }
  function cmp() {
    let node = add();
    while (peek() && ["<", "<=", ">", ">="].includes(peek().v)) {
      const op = tokens[pos++].v;
      node = { op, a: node, b: add() };
    }
    return node;
  }
  function add() {
    let node = mul();
    while (peek() && (peek().v === "+" || peek().v === "-")) {
      const op = tokens[pos++].v;
      node = { op, a: node, b: mul() };
    }
    return node;
  }
  function mul() {
    let node = unary();
    while (peek() && (peek().v === "*" || peek().v === "/")) {
      const op = tokens[pos++].v;
      node = { op, a: node, b: unary() };
    }
    return node;
  }
  function unary() {
    if (peek() && peek().v === "-") {
      pos += 1;
      return { op: "neg", a: unary() };
    }
    if (peek() && peek().v === "+") {
      pos += 1;
      return unary();
    }
    return power();
  }
  function power() {
    const base = atom();
    if (peek() && peek().v === "^") {
      pos += 1;
      return { op: "^", a: base, b: unary() };
    }
    return base;
  }
  function atom() {
    const tok = tokens[pos];
    if (!tok) throw new Error(`表达式「${src}」意外结束`);
    pos += 1;
    if (tok.t === "num") return { num: tok.v };
    if (tok.v === "(") {
      const node = cond();
      eat(")");
      return node;
    }
    if (tok.t === "id") {
      if (peek() && peek().v === "(") {
        if (!own(FUNCS, tok.v)) throw new Error(`表达式里的函数「${tok.v}」不在白名单里`);
        pos += 1;
        const args = [];
        if (peek() && peek().v !== ")") {
          args.push(cond());
          while (peek() && peek().v === ",") {
            pos += 1;
            args.push(cond());
          }
        }
        eat(")");
        return { fn: tok.v, args };
      }
      return { id: tok.v };
    }
    throw new Error(`表达式「${src}」里多了一个「${tok.v}」`);
  }

  const tree = cond();
  if (pos !== tokens.length) throw new Error(`表达式「${src}」末尾多出「${tokens[pos].v}」`);
  return tree;
}

/** 语法树里用到的标识符（不含函数名与常量），供校验脚本核对都有定义。 */
export function identifiers(tree, out = new Set()) {
  if (tree.id != null && !own(CONSTS, tree.id)) out.add(tree.id);
  for (const child of [tree.c, tree.a, tree.b, ...(tree.args ?? [])]) if (child) identifiers(child, out);
  return out;
}

export function evaluate(tree, env) {
  if (tree.num != null) return tree.num;
  if (tree.id != null) {
    if (own(env, tree.id)) return env[tree.id];
    if (own(CONSTS, tree.id)) return CONSTS[tree.id];
    throw new Error(`表达式里的「${tree.id}」没有定义`);
  }
  if (tree.fn) return FUNCS[tree.fn](...tree.args.map((arg) => evaluate(arg, env)));
  if (tree.op === "?") return evaluate(tree.c, env) ? evaluate(tree.a, env) : evaluate(tree.b, env);
  if (tree.op === "&&") return evaluate(tree.a, env) && evaluate(tree.b, env) ? 1 : 0;
  if (tree.op === "||") return evaluate(tree.a, env) || evaluate(tree.b, env) ? 1 : 0;
  const a = evaluate(tree.a, env);
  if (tree.op === "neg") return -a;
  const b = evaluate(tree.b, env);
  switch (tree.op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return a / b;
    case "^":
      return a ** b;
    case "<":
      return a < b ? 1 : 0;
    case "<=":
      return a <= b ? 1 : 0;
    case ">":
      return a > b ? 1 : 0;
    case ">=":
      return a >= b ? 1 : 0;
    default:
      throw new Error(`未知运算「${tree.op}」`);
  }
}

/** 解析一次、反复求值。 */
export function compile(src) {
  const tree = parseExpr(src);
  return (env) => evaluate(tree, env);
}
