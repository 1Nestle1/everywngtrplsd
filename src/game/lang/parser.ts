// Лексер и парсер Python-подобного языка игрока.
// Поддерживается подмножество Python: отступы, if/elif/else, while, for-in,
// def/return, break/continue/pass, global, import, списки, кортежи, словари,
// индексы, атрибуты, вызовы, арифметика, сравнения, and/or/not, тернарный if.

export class LangError extends Error {
  constructor(message: string, public line: number) {
    super(message);
  }
}

type TokType = "name" | "num" | "str" | "op" | "nl" | "indent" | "dedent" | "eof";
interface Tok {
  t: TokType;
  v: string;
  line: number;
}

const KEYWORDS = new Set([
  "if", "elif", "else", "while", "for", "in", "def", "return", "break", "continue",
  "pass", "and", "or", "not", "True", "False", "None", "global", "import", "from", "is",
]);

const OPS3 = ["**=", "//="];
const OPS2 = ["==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "//", "**"];
const OPS1 = "+-*/%<>=()[]{},:.";

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const indents = [0];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let depth = 0; // вложенность скобок: внутри них переносы строк игнорируются

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineNo = li + 1;
    let i = 0;
    if (depth === 0) {
      let col = 0;
      while (i < line.length && (line[i] === " " || line[i] === "\t")) {
        col += line[i] === "\t" ? 4 : 1;
        i++;
      }
      if (i >= line.length || line[i] === "#") continue; // пустая строка или комментарий
      if (col > indents[indents.length - 1]) {
        indents.push(col);
        out.push({ t: "indent", v: "", line: lineNo });
      } else {
        while (col < indents[indents.length - 1]) {
          indents.pop();
          out.push({ t: "dedent", v: "", line: lineNo });
        }
        if (col !== indents[indents.length - 1]) throw new LangError("Неверный отступ", lineNo);
      }
    }
    while (i < line.length) {
      const c = line[i];
      if (c === " " || c === "\t") { i++; continue; }
      if (c === "#") break;
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(line[i + 1] ?? ""))) {
        let j = i;
        while (j < line.length && /[0-9._]/.test(line[j])) j++;
        out.push({ t: "num", v: line.slice(i, j).replace(/_/g, ""), line: lineNo });
        i = j;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) j++;
        out.push({ t: "name", v: line.slice(i, j), line: lineNo });
        i = j;
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        let s = "";
        while (j < line.length && line[j] !== c) {
          if (line[j] === "\\" && j + 1 < line.length) {
            const e = line[j + 1];
            s += e === "n" ? "\n" : e === "t" ? "\t" : e;
            j += 2;
          } else s += line[j++];
        }
        if (j >= line.length) throw new LangError("Незакрытая строка", lineNo);
        out.push({ t: "str", v: s, line: lineNo });
        i = j + 1;
        continue;
      }
      const three = line.slice(i, i + 3);
      const two = line.slice(i, i + 2);
      let op = OPS3.includes(three) ? three : OPS2.includes(two) ? two : OPS1.includes(c) ? c : "";
      if (!op) throw new LangError(`Неожиданный символ «${c}»`, lineNo);
      if ("([{".includes(op)) depth++;
      if (")]}".includes(op)) depth = Math.max(0, depth - 1);
      out.push({ t: "op", v: op, line: lineNo });
      i += op.length;
    }
    if (depth === 0 && out.length && out[out.length - 1].t !== "nl") out.push({ t: "nl", v: "", line: lineNo });
  }
  const last = lines.length;
  while (indents.length > 1) {
    indents.pop();
    out.push({ t: "dedent", v: "", line: last });
  }
  out.push({ t: "eof", v: "", line: last });
  return out;
}

// --- AST ---
export type Expr =
  | { k: "num"; v: number; line: number }
  | { k: "str"; v: string; line: number }
  | { k: "const"; v: boolean | null; line: number }
  | { k: "name"; id: string; line: number }
  | { k: "list"; items: Expr[]; line: number }
  | { k: "tuple"; items: Expr[]; line: number }
  | { k: "dict"; keys: Expr[]; vals: Expr[]; line: number }
  | { k: "bin"; op: string; a: Expr; b: Expr; line: number }
  | { k: "unary"; op: string; a: Expr; line: number }
  | { k: "logic"; op: "and" | "or"; a: Expr; b: Expr; line: number }
  | { k: "cond"; test: Expr; a: Expr; b: Expr; line: number }
  | { k: "call"; fn: Expr; args: Expr[]; line: number }
  | { k: "index"; obj: Expr; idx: Expr; line: number }
  | { k: "attr"; obj: Expr; name: string; line: number };

export type Stmt =
  | { k: "expr"; e: Expr; line: number }
  | { k: "assign"; targets: Expr[]; e: Expr; line: number }
  | { k: "aug"; target: Expr; op: string; e: Expr; line: number }
  | { k: "if"; test: Expr; body: Stmt[]; orelse: Stmt[]; line: number }
  | { k: "while"; test: Expr; body: Stmt[]; line: number }
  | { k: "for"; target: Expr; iter: Expr; body: Stmt[]; line: number }
  | { k: "def"; name: string; params: string[]; body: Stmt[]; line: number }
  | { k: "return"; e: Expr | null; line: number }
  | { k: "break"; line: number }
  | { k: "continue"; line: number }
  | { k: "pass"; line: number }
  | { k: "global"; names: string[]; line: number }
  | { k: "import"; module: string; star: boolean; line: number };

/** Какие конструкции языка встретились в программе — для проверки разблокировок. */
export interface Features {
  loops: number; // строка первого while/for или 0
  ifs: number;
  defs: number;
  vars: number;
  lists: number;
  ops: number; // арифметика
  cmp: number; // сравнения и in
  imports: number;
}

export function parse(src: string): { body: Stmt[]; features: Features } {
  const toks = tokenize(src);
  let p = 0;
  const features: Features = { loops: 0, ifs: 0, defs: 0, vars: 0, lists: 0, ops: 0, cmp: 0, imports: 0 };
  const mark = (f: keyof Features, line: number) => {
    if (!features[f]) features[f] = line;
  };

  const peek = () => toks[p];
  const next = () => toks[p++];
  const is = (v: string) => {
    const t = toks[p];
    return (t.t === "op" || t.t === "name") && t.v === v;
  };
  const accept = (v: string) => (is(v) ? (p++, true) : false);
  const expect = (v: string) => {
    if (!accept(v)) throw new LangError(`Ожидалось «${v}»`, peek().line);
  };
  const expectName = (): string => {
    const t = next();
    if (t.t !== "name" || KEYWORDS.has(t.v)) throw new LangError("Ожидалось имя", t.line);
    return t.v;
  };

  function block(): Stmt[] {
    expect(":");
    if (peek().t !== "nl") {
      // однострочное тело: if x: harvest()
      return [simple()];
    }
    next();
    if (peek().t !== "indent") throw new LangError("Ожидался блок с отступом", peek().line);
    next();
    const body: Stmt[] = [];
    while (peek().t !== "dedent" && peek().t !== "eof") body.push(statement());
    if (peek().t === "dedent") next();
    return body;
  }

  function statement(): Stmt {
    const t = peek();
    const line = t.line;
    if (t.t === "name") {
      switch (t.v) {
        case "if": {
          next();
          mark("ifs", line);
          const test = expr();
          const body = block();
          let orelse: Stmt[] = [];
          if (is("elif")) {
            orelse = [statement()]; // elif разбирается как вложенный if
          } else if (accept("else")) orelse = block();
          return { k: "if", test, body, orelse, line };
        }
        case "elif": {
          next();
          const test = expr();
          const body = block();
          let orelse: Stmt[] = [];
          if (is("elif")) orelse = [statement()];
          else if (accept("else")) orelse = block();
          return { k: "if", test, body, orelse, line };
        }
        case "while": {
          next();
          mark("loops", line);
          const test = expr();
          return { k: "while", test, body: block(), line };
        }
        case "for": {
          next();
          mark("loops", line);
          mark("vars", line);
          const target = targetList();
          expect("in");
          const iter = expr();
          return { k: "for", target, iter, body: block(), line };
        }
        case "def": {
          next();
          mark("defs", line);
          const name = expectName();
          expect("(");
          const params: string[] = [];
          if (!is(")")) {
            do params.push(expectName());
            while (accept(","));
          }
          expect(")");
          return { k: "def", name, params, body: block(), line };
        }
      }
    }
    const s = simple();
    return s;
  }

  function simple(): Stmt {
    const t = peek();
    const line = t.line;
    let s: Stmt;
    if (t.t === "name" && t.v === "return") {
      next();
      const end = peek().t === "nl" || peek().t === "eof" || peek().t === "dedent";
      s = { k: "return", e: end ? null : exprList(), line };
    } else if (t.t === "name" && (t.v === "break" || t.v === "continue" || t.v === "pass")) {
      next();
      s = { k: t.v as "break" | "continue" | "pass", line };
    } else if (t.t === "name" && t.v === "global") {
      next();
      const names = [expectName()];
      while (accept(",")) names.push(expectName());
      s = { k: "global", names, line };
    } else if (t.t === "name" && t.v === "import") {
      next();
      mark("imports", line);
      s = { k: "import", module: expectName(), star: false, line };
    } else if (t.t === "name" && t.v === "from") {
      next();
      mark("imports", line);
      const module = expectName();
      expect("import");
      expect("*");
      s = { k: "import", module, star: true, line };
    } else {
      const e = exprList();
      if (is("=")) {
        const targets = [e];
        let value: Expr = e;
        while (accept("=")) {
          value = exprList();
          targets.push(value);
        }
        targets.pop();
        for (const tg of targets) checkTarget(tg);
        mark("vars", line);
        s = { k: "assign", targets, e: value, line };
      } else if (peek().t === "op" && ["+=", "-=", "*=", "/=", "%=", "//=", "**="].includes(peek().v)) {
        const op = next().v.slice(0, -1);
        checkTarget(e);
        mark("vars", line);
        mark("ops", line);
        s = { k: "aug", target: e, op, e: exprList(), line };
      } else s = { k: "expr", e, line };
    }
    if (peek().t === "nl") next();
    else if (peek().t !== "eof" && peek().t !== "dedent") throw new LangError("Ожидался конец строки", peek().line);
    return s;
  }

  function checkTarget(e: Expr): void {
    if (e.k === "name" || e.k === "index" || e.k === "attr") return;
    if (e.k === "tuple" || e.k === "list") return e.items.forEach(checkTarget);
    throw new LangError("Сюда нельзя присвоить значение", e.line);
  }

  function targetList(): Expr {
    const line = peek().line;
    const first = postfix();
    if (!is(",")) return first;
    const items = [first];
    while (accept(",")) items.push(postfix());
    return { k: "tuple", items, line };
  }

  function exprList(): Expr {
    const line = peek().line;
    const first = expr();
    if (!is(",")) return first;
    const items = [first];
    while (accept(",")) {
      if (peek().t === "nl" || is("=") || is(")")) break;
      items.push(expr());
    }
    mark("lists", line);
    return { k: "tuple", items, line };
  }

  function expr(): Expr {
    const a = orExpr();
    if (is("if")) {
      const line = next().line;
      const test = orExpr();
      expect("else");
      const b = expr();
      mark("ifs", line);
      return { k: "cond", test, a, b, line };
    }
    return a;
  }
  function orExpr(): Expr {
    let a = andExpr();
    while (is("or")) {
      const line = next().line;
      a = { k: "logic", op: "or", a, b: andExpr(), line };
    }
    return a;
  }
  function andExpr(): Expr {
    let a = notExpr();
    while (is("and")) {
      const line = next().line;
      a = { k: "logic", op: "and", a, b: notExpr(), line };
    }
    return a;
  }
  function notExpr(): Expr {
    if (is("not")) {
      const line = next().line;
      return { k: "unary", op: "not", a: notExpr(), line };
    }
    return comparison();
  }
  function comparison(): Expr {
    let a = arith();
    for (;;) {
      const t = peek();
      let op = "";
      if (t.t === "op" && ["==", "!=", "<", ">", "<=", ">="].includes(t.v)) op = t.v;
      else if (is("in")) op = "in";
      else if (is("not") && toks[p + 1].v === "in") {
        p++;
        op = "not in";
      } else if (is("is")) {
        if (toks[p + 1].v === "not") {
          p++;
          op = "!=";
        } else op = "==";
      }
      if (!op) return a;
      next();
      mark("cmp", t.line);
      a = { k: "bin", op, a, b: arith(), line: t.line };
    }
  }
  function arith(): Expr {
    let a = term();
    while (is("+") || is("-")) {
      const t = next();
      mark("ops", t.line);
      a = { k: "bin", op: t.v, a, b: term(), line: t.line };
    }
    return a;
  }
  function term(): Expr {
    let a = unary();
    while (is("*") || is("/") || is("//") || is("%")) {
      const t = next();
      mark("ops", t.line);
      a = { k: "bin", op: t.v, a, b: unary(), line: t.line };
    }
    return a;
  }
  function unary(): Expr {
    if (is("-") || is("+")) {
      const t = next();
      return { k: "unary", op: t.v, a: unary(), line: t.line };
    }
    return power();
  }
  function power(): Expr {
    const a = postfix();
    if (is("**")) {
      const t = next();
      mark("ops", t.line);
      return { k: "bin", op: "**", a, b: unary(), line: t.line };
    }
    return a;
  }
  function postfix(): Expr {
    let e = atom();
    for (;;) {
      if (is("(")) {
        const line = next().line;
        const args: Expr[] = [];
        if (!is(")")) {
          do {
            if (is(")")) break;
            args.push(expr());
          } while (accept(","));
        }
        expect(")");
        e = { k: "call", fn: e, args, line };
      } else if (is("[")) {
        const line = next().line;
        const idx = expr();
        expect("]");
        mark("lists", line);
        e = { k: "index", obj: e, idx, line };
      } else if (is(".")) {
        const line = next().line;
        const t = next();
        if (t.t !== "name") throw new LangError("Ожидалось имя после точки", line);
        e = { k: "attr", obj: e, name: t.v, line };
      } else return e;
    }
  }
  function atom(): Expr {
    const t = next();
    const line = t.line;
    if (t.t === "num") return { k: "num", v: Number(t.v), line };
    if (t.t === "str") return { k: "str", v: t.v, line };
    if (t.t === "name") {
      if (t.v === "True") return { k: "const", v: true, line };
      if (t.v === "False") return { k: "const", v: false, line };
      if (t.v === "None") return { k: "const", v: null, line };
      if (KEYWORDS.has(t.v)) throw new LangError(`Неожиданное слово «${t.v}»`, line);
      return { k: "name", id: t.v, line };
    }
    if (t.t === "op" && t.v === "(") {
      if (accept(")")) return { k: "tuple", items: [], line };
      const first = expr();
      if (accept(")")) return first;
      const items = [first];
      while (accept(",")) {
        if (is(")")) break;
        items.push(expr());
      }
      expect(")");
      mark("lists", line);
      return { k: "tuple", items, line };
    }
    if (t.t === "op" && t.v === "[") {
      mark("lists", line);
      const items: Expr[] = [];
      while (!is("]")) {
        items.push(expr());
        if (!accept(",")) break;
      }
      expect("]");
      return { k: "list", items, line };
    }
    if (t.t === "op" && t.v === "{") {
      mark("lists", line);
      const keys: Expr[] = [];
      const vals: Expr[] = [];
      while (!is("}")) {
        keys.push(expr());
        expect(":");
        vals.push(expr());
        if (!accept(",")) break;
      }
      expect("}");
      return { k: "dict", keys, vals, line };
    }
    if (t.t === "eof" || t.t === "nl") throw new LangError("Неожиданный конец строки", line);
    throw new LangError(`Неожиданный символ «${t.v}»`, line);
  }

  const body: Stmt[] = [];
  while (peek().t !== "eof") {
    if (peek().t === "nl") { next(); continue; }
    if (peek().t === "indent") throw new LangError("Лишний отступ", peek().line);
    body.push(statement());
  }
  return { body, features };
}
