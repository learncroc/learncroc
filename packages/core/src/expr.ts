/**
 * A tiny safe expression evaluator (PLAN D28). No eval, no property access, no assignment.
 * Shared by widgets (plot), the grader and parametric items.
 *
 * Grammar: numbers (1, 0.5, 1e-3), variables, constants `pi` and `e`, + - * / % ^ (right-assoc),
 * unary + and -, parentheses, and calls to the whitelisted functions in FUNCTIONS.
 * `log(x)` is the natural log; `log(x, b)` uses base b; `log10`, `log2` and `ln` also exist.
 */

export class ExprError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
    this.name = "ExprError";
  }
}

export type Expr =
  | { t: "num"; v: number }
  | { t: "var"; name: string; pos: number }
  | { t: "neg"; x: Expr }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "%" | "^"; a: Expr; b: Expr }
  | { t: "call"; fn: string; args: Expr[]; pos: number };

const FUNCTIONS: Record<string, { arity: [number, number]; f: (...a: number[]) => number }> = {
  sqrt: { arity: [1, 1], f: Math.sqrt },
  cbrt: { arity: [1, 1], f: Math.cbrt },
  abs: { arity: [1, 1], f: Math.abs },
  exp: { arity: [1, 1], f: Math.exp },
  ln: { arity: [1, 1], f: Math.log },
  log: { arity: [1, 2], f: (x, b) => (b === undefined ? Math.log(x) : Math.log(x) / Math.log(b)) },
  log10: { arity: [1, 1], f: Math.log10 },
  log2: { arity: [1, 1], f: Math.log2 },
  sin: { arity: [1, 1], f: Math.sin },
  cos: { arity: [1, 1], f: Math.cos },
  tan: { arity: [1, 1], f: Math.tan },
  asin: { arity: [1, 1], f: Math.asin },
  acos: { arity: [1, 1], f: Math.acos },
  atan: { arity: [1, 1], f: Math.atan },
  atan2: { arity: [2, 2], f: Math.atan2 },
  sinh: { arity: [1, 1], f: Math.sinh },
  cosh: { arity: [1, 1], f: Math.cosh },
  tanh: { arity: [1, 1], f: Math.tanh },
  floor: { arity: [1, 1], f: Math.floor },
  ceil: { arity: [1, 1], f: Math.ceil },
  round: { arity: [1, 2], f: (x, d) => (d === undefined ? Math.round(x) : Math.round(x * 10 ** d) / 10 ** d) },
  sign: { arity: [1, 1], f: Math.sign },
  min: { arity: [1, 16], f: Math.min },
  max: { arity: [1, 16], f: Math.max },
  pow: { arity: [2, 2], f: Math.pow },
  hypot: { arity: [1, 16], f: Math.hypot },
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** Own-property lookup only, so names like "constructor" or "__proto__" never resolve. */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

const MAX_LENGTH = 500;
const MAX_DEPTH = 64;

type Token =
  | { k: "num"; v: number; pos: number }
  | { k: "id"; v: string; pos: number }
  | { k: "op"; v: string; pos: number }
  | { k: "end"; pos: number };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ k: "num", v: Number(num[0]), pos: i });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      out.push({ k: "id", v: id[0], pos: i });
      i += id[0].length;
      continue;
    }
    if (c === "*" && src.charAt(i + 1) === "*") {
      out.push({ k: "op", v: "^", pos: i });
      i += 2;
      continue;
    }
    if ("+-*/%^(),".includes(c)) {
      out.push({ k: "op", v: c, pos: i });
      i++;
      continue;
    }
    throw new ExprError(`unexpected character '${c}'`, i);
  }
  out.push({ k: "end", pos: src.length });
  return out;
}

/** Parse an expression into an AST. Throws ExprError with a position on bad input. */
export function parseExpr(src: string): Expr {
  if (src.length > MAX_LENGTH) throw new ExprError(`expression longer than ${MAX_LENGTH} characters`, 0);
  const tokens = tokenize(src);
  let p = 0;
  let depth = 0;
  const peek = (): Token => tokens[p] ?? { k: "end", pos: src.length };
  const isOp = (v: string) => {
    const t = peek();
    return t.k === "op" && t.v === v;
  };
  const expectOp = (v: string) => {
    const t = peek();
    if (t.k !== "op" || t.v !== v) throw new ExprError(`expected '${v}'`, t.pos);
    p++;
  };

  // expr := term (('+'|'-') term)*
  const expr = (): Expr => {
    if (++depth > MAX_DEPTH) throw new ExprError("expression nested too deeply", peek().pos);
    let a = term();
    while (isOp("+") || isOp("-")) {
      const op = (peek() as { v: "+" | "-" }).v;
      p++;
      a = { t: "bin", op, a, b: term() };
    }
    depth--;
    return a;
  };
  // term := unary (('*'|'/'|'%') unary)*
  const term = (): Expr => {
    let a = unary();
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = (peek() as { v: "*" | "/" | "%" }).v;
      p++;
      a = { t: "bin", op, a, b: unary() };
    }
    return a;
  };
  // unary := ('-'|'+') unary | power
  const unary = (): Expr => {
    if (isOp("-")) {
      p++;
      return { t: "neg", x: unary() };
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return power();
  };
  // power := atom ('^' unary)?   (right-associative; -2^2 = -4, 2^-1 = 0.5)
  const power = (): Expr => {
    const base = atom();
    if (isOp("^")) {
      p++;
      return { t: "bin", op: "^", a: base, b: unary() };
    }
    return base;
  };
  const atom = (): Expr => {
    const t = peek();
    if (t.k === "num") {
      p++;
      return { t: "num", v: t.v };
    }
    if (t.k === "id") {
      p++;
      if (isOp("(")) {
        p++;
        const fn = own(FUNCTIONS, t.v);
        if (!fn) throw new ExprError(`unknown function '${t.v}'`, t.pos);
        const args: Expr[] = [];
        if (!isOp(")")) {
          args.push(expr());
          while (isOp(",")) {
            p++;
            args.push(expr());
          }
        }
        expectOp(")");
        if (args.length < fn.arity[0] || args.length > fn.arity[1]) {
          throw new ExprError(`'${t.v}' takes ${fn.arity[0]}–${fn.arity[1]} arguments`, t.pos);
        }
        return { t: "call", fn: t.v, args, pos: t.pos };
      }
      return { t: "var", name: t.v, pos: t.pos };
    }
    if (t.k === "op" && t.v === "(") {
      p++;
      const inner = expr();
      expectOp(")");
      return inner;
    }
    throw new ExprError(t.k === "end" ? "unexpected end of expression" : `unexpected '${t.v}'`, t.pos);
  };

  const ast = expr();
  const rest = peek();
  if (rest.k !== "end")
    throw new ExprError(`unexpected '${rest.k === "op" || rest.k === "id" ? rest.v : rest.k}'`, rest.pos);
  return ast;
}

/** Evaluate a parsed expression. Unknown variables throw ExprError. */
export function evalExpr(ast: Expr, vars: Readonly<Record<string, number>> = {}): number {
  switch (ast.t) {
    case "num":
      return ast.v;
    case "var": {
      const v = Object.hasOwn(vars, ast.name) ? vars[ast.name] : own(CONSTANTS, ast.name);
      if (v === undefined) throw new ExprError(`unknown variable '${ast.name}'`, ast.pos);
      return v;
    }
    case "neg":
      return -evalExpr(ast.x, vars);
    case "bin": {
      const a = evalExpr(ast.a, vars);
      const b = evalExpr(ast.b, vars);
      switch (ast.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "%":
          return a % b;
        case "^":
          return a ** b;
      }
      break;
    }
    case "call": {
      const fn = own(FUNCTIONS, ast.fn);
      if (!fn) throw new ExprError(`unknown function '${ast.fn}'`, ast.pos);
      return fn.f(...ast.args.map((x) => evalExpr(x, vars)));
    }
  }
  throw new ExprError("invalid expression", 0);
}

/** Parse and evaluate in one step. */
export function evaluate(src: string, vars: Readonly<Record<string, number>> = {}): number {
  return evalExpr(parseExpr(src), vars);
}

/** Compile once, evaluate many times (plot sampling). */
export function compileExpr(src: string): (vars?: Readonly<Record<string, number>>) => number {
  const ast = parseExpr(src);
  return (vars = {}) => evalExpr(ast, vars);
}

/** Free variable names used by an expression (constants excluded). */
export function exprVariables(src: string): string[] {
  const names = new Set<string>();
  const walk = (e: Expr): void => {
    if (e.t === "var" && own(CONSTANTS, e.name) === undefined) names.add(e.name);
    else if (e.t === "neg") walk(e.x);
    else if (e.t === "bin") {
      walk(e.a);
      walk(e.b);
    } else if (e.t === "call") e.args.forEach(walk);
  };
  walk(parseExpr(src));
  return [...names];
}
