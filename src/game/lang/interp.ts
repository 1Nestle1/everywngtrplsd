// Интерпретатор языка игрока на генераторах.
// Каждая инструкция уступает управление (yield) игре: так программа исполняется
// по «тикам», бесконечный цикл не вешает вкладку, а игровые функции (move, harvest…)
// исполняет хост — интерпретатор о мире ничего не знает.

import { LangError, parse, type Expr, type Features, type Stmt } from "./parser";

export { LangError };

export class EnumVal {
  constructor(public group: string, public name: string) {}
}
export class Namespace {
  constructor(public name: string, public members: Map<string, Value>) {}
}
export class Tuple {
  constructor(public items: Value[]) {}
}
export class Range {
  constructor(public start: number, public stop: number, public step: number) {}
  get length(): number {
    return Math.max(0, Math.ceil((this.stop - this.start) / this.step));
  }
}
export class PyDict {
  map = new Map<string, [Value, Value]>();
}
export class UserFunc {
  constructor(
    public name: string,
    public params: string[],
    public body: Stmt[],
    public globals: Scope,
    public file: string,
  ) {}
}
/** Функция хоста. pure — вычисляется сразу, иначе уходит в игру через yield. */
export class HostFunc {
  constructor(public name: string, public pure?: (args: Value[], line: number) => Value) {}
}
export class Module {
  constructor(public name: string, public scope: Scope) {}
}
class BoundMethod {
  constructor(public self: Value, public name: string) {}
}

export type Value =
  | number | string | boolean | null
  | Value[] | Tuple | PyDict | Range
  | EnumVal | Namespace | UserFunc | HostFunc | Module | BoundMethod;

export class Scope {
  vars = new Map<string, Value>();
  globalNames: Set<string> | null = null;
  constructor(public parent: Scope | null) {}
}

/** Что интерпретатор отдаёт игре. */
export type Yielded =
  | { kind: "tick"; line: number; file: string }
  | { kind: "call"; name: string; args: Value[]; line: number; file: string };

export interface Host {
  builtins: Map<string, Value>;
  /** Подсказка, если имя существует в игре, но ещё не разблокировано. */
  lockedHint(name: string): string | null;
  /** Исходник другого файла для import. */
  getSource(name: string): string | null;
  /** Проверка разрешённых конструкций языка. */
  checkFeatures(f: Features, file: string): void;
}

const NORMAL = 0, BREAK = 1, CONTINUE = 2, RETURN = 3;
type Signal = 0 | 1 | 2 | 3;
type Gen<T> = Generator<Yielded, T, Value>;

export function truthy(v: Value): boolean {
  if (v === null || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Tuple) return v.items.length > 0;
  if (v instanceof PyDict) return v.map.size > 0;
  if (v instanceof Range) return v.length > 0;
  return true;
}

export function repr(v: Value, top = true): string {
  if (v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === "string") return top ? v : JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map((x) => repr(x, false)).join(", ") + "]";
  if (v instanceof Tuple) return "(" + v.items.map((x) => repr(x, false)).join(", ") + (v.items.length === 1 ? ",)" : ")");
  if (v instanceof PyDict) return "{" + [...v.map.values()].map(([k, x]) => repr(k, false) + ": " + repr(x, false)).join(", ") + "}";
  if (v instanceof Range) return `range(${v.start}, ${v.stop})`;
  if (v instanceof EnumVal) return v.group ? `${v.group}.${v.name}` : v.name;
  if (v instanceof Namespace) return v.name;
  if (v instanceof UserFunc) return `<функция ${v.name}>`;
  if (v instanceof HostFunc) return `<функция ${v.name}>`;
  if (v instanceof Module) return `<модуль ${v.name}>`;
  return "<метод>";
}

function typeName(v: Value): string {
  if (v === null) return "None";
  if (typeof v === "number") return "число";
  if (typeof v === "string") return "строка";
  if (typeof v === "boolean") return "bool";
  if (Array.isArray(v)) return "список";
  if (v instanceof Tuple) return "кортеж";
  if (v instanceof PyDict) return "словарь";
  return "объект";
}

function keyOf(v: Value, line: number): string {
  if (typeof v === "number") return "n" + v;
  if (typeof v === "boolean") return "n" + (v ? 1 : 0);
  if (typeof v === "string") return "s" + v;
  if (v === null) return "None";
  if (v instanceof EnumVal) return "e" + v.group + "." + v.name;
  if (v instanceof Tuple) return "t(" + v.items.map((x) => keyOf(x, line)).join(",") + ")";
  throw new LangError(`${typeName(v)} нельзя использовать как ключ словаря`, line);
}

export function equals(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (typeof a === "boolean") a = a ? 1 : 0;
  if (typeof b === "boolean") b = b ? 1 : 0;
  if (a === b) return true;
  const la = Array.isArray(a) ? a : a instanceof Tuple ? a.items : null;
  const lb = Array.isArray(b) ? b : b instanceof Tuple ? b.items : null;
  if (la && lb && Array.isArray(a) === Array.isArray(b)) {
    return la.length === lb.length && la.every((x, i) => equals(x, lb[i]));
  }
  return false;
}

function compare(a: Value, b: Value, line: number): number {
  if (typeof a === "boolean") a = a ? 1 : 0;
  if (typeof b === "boolean") b = b ? 1 : 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  const la = Array.isArray(a) ? a : a instanceof Tuple ? a.items : null;
  const lb = Array.isArray(b) ? b : b instanceof Tuple ? b.items : null;
  if (la && lb) {
    for (let i = 0; i < Math.min(la.length, lb.length); i++) {
      const c = compare(la[i], lb[i], line);
      if (c !== 0) return c;
    }
    return la.length - lb.length;
  }
  throw new LangError(`Нельзя сравнить ${typeName(a)} и ${typeName(b)}`, line);
}

function num(v: Value, line: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  throw new LangError(`Ожидалось число, а получено ${typeName(v)} (${repr(v, false)})`, line);
}

export function iterate(v: Value, line: number): Iterable<Value> {
  if (Array.isArray(v)) return v.slice();
  if (v instanceof Tuple) return v.items;
  if (typeof v === "string") return [...v];
  if (v instanceof PyDict) return [...v.map.values()].map(([k]) => k);
  if (v instanceof Range) {
    const r = v;
    return {
      *[Symbol.iterator]() {
        if (r.step > 0) for (let i = r.start; i < r.stop; i += r.step) yield i;
        else for (let i = r.start; i > r.stop; i += r.step) yield i;
      },
    };
  }
  throw new LangError(`По значению типа ${typeName(v)} нельзя пройти циклом`, line);
}

function binop(op: string, a: Value, b: Value, line: number): Value {
  switch (op) {
    case "+":
      if (typeof a === "string" && typeof b === "string") return a + b;
      if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
      if (a instanceof Tuple && b instanceof Tuple) return new Tuple(a.items.concat(b.items));
      if (typeof a === "string" || typeof b === "string")
        throw new LangError("Строку можно сложить только со строкой. Используйте str(x)", line);
      return num(a, line) + num(b, line);
    case "-": return num(a, line) - num(b, line);
    case "*":
      if (typeof a === "string") return a.repeat(Math.max(0, num(b, line)));
      if (Array.isArray(a)) {
        const out: Value[] = [];
        for (let i = 0; i < num(b, line); i++) out.push(...a);
        return out;
      }
      return num(a, line) * num(b, line);
    case "/": {
      const d = num(b, line);
      if (d === 0) throw new LangError("Деление на ноль", line);
      return num(a, line) / d;
    }
    case "//": {
      const d = num(b, line);
      if (d === 0) throw new LangError("Деление на ноль", line);
      return Math.floor(num(a, line) / d);
    }
    case "%": {
      const d = num(b, line);
      if (d === 0) throw new LangError("Деление на ноль", line);
      const x = num(a, line);
      return ((x % d) + d) % d;
    }
    case "**": return num(a, line) ** num(b, line);
    case "==": return equals(a, b);
    case "!=": return !equals(a, b);
    case "<": return compare(a, b, line) < 0;
    case ">": return compare(a, b, line) > 0;
    case "<=": return compare(a, b, line) <= 0;
    case ">=": return compare(a, b, line) >= 0;
    case "in":
    case "not in": {
      let r: boolean;
      if (typeof b === "string") r = typeof a === "string" && b.includes(a);
      else if (b instanceof PyDict) r = b.map.has(keyOf(a, line));
      else r = [...iterate(b, line)].some((x) => equals(x, a));
      return op === "in" ? r : !r;
    }
  }
  throw new LangError(`Неизвестный оператор ${op}`, line);
}

function normIndex(i: number, len: number, line: number): number {
  if (!Number.isInteger(i)) throw new LangError("Индекс должен быть целым числом", line);
  const j = i < 0 ? len + i : i;
  if (j < 0 || j >= len) throw new LangError(`Индекс ${i} вне диапазона (длина ${len})`, line);
  return j;
}

export class Interpreter {
  private modules = new Map<string, Module>();
  private depth = 0;
  private retVal: Value = null;
  curFile = "";

  constructor(private host: Host) {}

  /** Генератор, исполняющий файл целиком. */
  *run(file: string, src: string): Gen<void> {
    try {
      const mod = new Module(file, new Scope(null));
      this.modules.set(file, mod);
      yield* this.execModule(mod, src);
    } catch (e) {
      if (e instanceof LangError && !(e as LangError & { file?: string }).file)
        (e as LangError & { file?: string }).file = this.curFile;
      throw e;
    }
  }

  private *execModule(mod: Module, src: string): Gen<void> {
    const prev = this.curFile;
    this.curFile = mod.name;
    const { body, features } = parse(src);
    this.host.checkFeatures(features, mod.name);
    const sig = yield* this.execBlock(body, mod.scope);
    if (sig === BREAK || sig === CONTINUE) throw new LangError("break/continue вне цикла", 1);
    this.curFile = prev;
  }

  private *execBlock(body: Stmt[], scope: Scope): Gen<Signal> {
    for (const s of body) {
      const sig = yield* this.exec(s, scope);
      if (sig !== NORMAL) return sig;
    }
    return NORMAL;
  }

  private *exec(s: Stmt, scope: Scope): Gen<Signal> {
    yield { kind: "tick", line: s.line, file: this.curFile };
    switch (s.k) {
      case "expr":
        yield* this.eval(s.e, scope);
        return NORMAL;
      case "assign": {
        const v = yield* this.eval(s.e, scope);
        for (const t of s.targets) yield* this.assign(t, v, scope);
        return NORMAL;
      }
      case "aug": {
        const cur = yield* this.eval(s.target, scope);
        const rhs = yield* this.eval(s.e, scope);
        if (Array.isArray(cur) && s.op === "+") {
          cur.push(...iterate(rhs, s.line));
          return NORMAL;
        }
        yield* this.assign(s.target, binop(s.op, cur, rhs, s.line), scope);
        return NORMAL;
      }
      case "if": {
        const t = yield* this.eval(s.test, scope);
        return yield* this.execBlock(truthy(t) ? s.body : s.orelse, scope);
      }
      case "while":
        for (;;) {
          const t = yield* this.eval(s.test, scope);
          if (!truthy(t)) return NORMAL;
          const sig = yield* this.execBlock(s.body, scope);
          if (sig === BREAK) return NORMAL;
          if (sig === RETURN) return sig;
          yield { kind: "tick", line: s.line, file: this.curFile };
        }
      case "for": {
        const it = yield* this.eval(s.iter, scope);
        for (const v of iterate(it, s.line)) {
          yield* this.assign(s.target, v, scope);
          const sig = yield* this.execBlock(s.body, scope);
          if (sig === BREAK) return NORMAL;
          if (sig === RETURN) return sig;
        }
        return NORMAL;
      }
      case "def":
        this.setVar(scope, s.name, new UserFunc(s.name, s.params, s.body, scope.parent ?? scope, this.curFile));
        return NORMAL;
      case "return":
        this.retVal = s.e ? yield* this.eval(s.e, scope) : null;
        if (!scope.parent) throw new LangError("return вне функции", s.line);
        return RETURN;
      case "break":
        return BREAK;
      case "continue":
        return CONTINUE;
      case "pass":
        return NORMAL;
      case "global":
        if (scope.parent) {
          scope.globalNames ??= new Set();
          for (const n of s.names) scope.globalNames.add(n);
        }
        return NORMAL;
      case "import": {
        let mod = this.modules.get(s.module);
        if (!mod) {
          const src = this.host.getSource(s.module);
          if (src === null) throw new LangError(`Файл «${s.module}» не найден`, s.line);
          mod = new Module(s.module, new Scope(null));
          this.modules.set(s.module, mod);
          yield* this.execModule(mod, src);
        }
        if (s.star) for (const [k, v] of mod.scope.vars) this.setVar(scope, k, v);
        else this.setVar(scope, s.module, mod);
        return NORMAL;
      }
    }
  }

  private setVar(scope: Scope, name: string, v: Value): void {
    if (scope.globalNames?.has(name) && scope.parent) scope.parent.vars.set(name, v);
    else scope.vars.set(name, v);
  }

  private *assign(t: Expr, v: Value, scope: Scope): Gen<void> {
    if (t.k === "name") {
      this.setVar(scope, t.id, v);
    } else if (t.k === "index") {
      const obj = yield* this.eval(t.obj, scope);
      const idx = yield* this.eval(t.idx, scope);
      if (Array.isArray(obj)) obj[normIndex(num(idx, t.line), obj.length, t.line)] = v;
      else if (obj instanceof PyDict) obj.map.set(keyOf(idx, t.line), [idx, v]);
      else throw new LangError(`Нельзя изменить элемент: ${typeName(obj)}`, t.line);
    } else if (t.k === "tuple" || t.k === "list") {
      const items = [...iterate(v, t.line)];
      if (items.length !== t.items.length)
        throw new LangError(`Ожидалось ${t.items.length} значений, получено ${items.length}`, t.line);
      for (let i = 0; i < items.length; i++) yield* this.assign(t.items[i], items[i], scope);
    } else if (t.k === "attr") {
      const obj = yield* this.eval(t.obj, scope);
      if (obj instanceof Module) obj.scope.vars.set(t.name, v);
      else throw new LangError("Нельзя присвоить атрибут", t.line);
    }
  }

  private lookup(name: string, scope: Scope, line: number): Value {
    let s: Scope | null = scope;
    while (s) {
      const v = s.vars.get(name);
      if (v !== undefined) return v;
      if (s.vars.has(name)) return v as unknown as Value;
      s = s.parent;
    }
    const b = this.host.builtins.get(name);
    if (b !== undefined) return b;
    const hint = this.host.lockedHint(name);
    if (hint) throw new LangError(hint, line);
    throw new LangError(`Имя «${name}» не определено`, line);
  }

  private *eval(e: Expr, scope: Scope): Gen<Value> {
    switch (e.k) {
      case "num": return e.v;
      case "str": return e.v;
      case "const": return e.v;
      case "name": return this.lookup(e.id, scope, e.line);
      case "list": {
        const out: Value[] = [];
        for (const x of e.items) out.push(yield* this.eval(x, scope));
        return out;
      }
      case "tuple": {
        const out: Value[] = [];
        for (const x of e.items) out.push(yield* this.eval(x, scope));
        return new Tuple(out);
      }
      case "dict": {
        const d = new PyDict();
        for (let i = 0; i < e.keys.length; i++) {
          const k = yield* this.eval(e.keys[i], scope);
          d.map.set(keyOf(k, e.line), [k, yield* this.eval(e.vals[i], scope)]);
        }
        return d;
      }
      case "bin": {
        const a = yield* this.eval(e.a, scope);
        const b = yield* this.eval(e.b, scope);
        return binop(e.op, a, b, e.line);
      }
      case "unary": {
        const a = yield* this.eval(e.a, scope);
        if (e.op === "not") return !truthy(a);
        if (e.op === "-") return -num(a, e.line);
        return num(a, e.line);
      }
      case "logic": {
        const a = yield* this.eval(e.a, scope);
        if (e.op === "and" ? !truthy(a) : truthy(a)) return a;
        return yield* this.eval(e.b, scope);
      }
      case "cond": {
        const t = yield* this.eval(e.test, scope);
        return yield* this.eval(truthy(t) ? e.a : e.b, scope);
      }
      case "index": {
        const obj = yield* this.eval(e.obj, scope);
        const idx = yield* this.eval(e.idx, scope);
        if (Array.isArray(obj)) return obj[normIndex(num(idx, e.line), obj.length, e.line)];
        if (obj instanceof Tuple) return obj.items[normIndex(num(idx, e.line), obj.items.length, e.line)];
        if (typeof obj === "string") return obj[normIndex(num(idx, e.line), obj.length, e.line)];
        if (obj instanceof PyDict) {
          const hit = obj.map.get(keyOf(idx, e.line));
          if (!hit) throw new LangError(`Ключа ${repr(idx, false)} нет в словаре`, e.line);
          return hit[1];
        }
        throw new LangError(`Нельзя взять элемент у значения типа ${typeName(obj)}`, e.line);
      }
      case "attr": {
        const obj = yield* this.eval(e.obj, scope);
        if (obj instanceof Namespace) {
          const v = obj.members.get(e.name);
          if (v === undefined) {
            const hint = this.host.lockedHint(`${obj.name}.${e.name}`);
            throw new LangError(hint ?? `В ${obj.name} нет «${e.name}»`, e.line);
          }
          return v;
        }
        if (obj instanceof Module) {
          const v = obj.scope.vars.get(e.name);
          if (v === undefined) throw new LangError(`В файле ${obj.name} нет «${e.name}»`, e.line);
          return v;
        }
        return new BoundMethod(obj, e.name);
      }
      case "call": {
        const fn = yield* this.eval(e.fn, scope);
        const args: Value[] = [];
        for (const a of e.args) args.push(yield* this.eval(a, scope));
        return yield* this.call(fn, args, e.line);
      }
    }
  }

  private *call(fn: Value, args: Value[], line: number): Gen<Value> {
    if (fn instanceof HostFunc) {
      if (fn.pure) return fn.pure(args, line);
      return yield { kind: "call", name: fn.name, args, line, file: this.curFile };
    }
    if (fn instanceof UserFunc) {
      if (args.length !== fn.params.length)
        throw new LangError(`${fn.name}() ждёт аргументов: ${fn.params.length}, передано: ${args.length}`, line);
      if (this.depth > 200) throw new LangError("Слишком глубокая рекурсия", line);
      const local = new Scope(fn.globals);
      fn.params.forEach((p, i) => local.vars.set(p, args[i]));
      const prevFile = this.curFile;
      this.curFile = fn.file;
      this.depth++;
      try {
        const sig = yield* this.execBlock(fn.body, local);
        const r = sig === RETURN ? this.retVal : null;
        this.retVal = null;
        return r;
      } finally {
        this.depth--;
        this.curFile = prevFile;
      }
    }
    if (fn instanceof BoundMethod) return callMethod(fn.self, fn.name, args, line);
    throw new LangError(`${repr(fn, false)} нельзя вызвать как функцию`, line);
  }
}

function callMethod(self: Value, name: string, args: Value[], line: number): Value {
  if (Array.isArray(self)) {
    switch (name) {
      case "append": self.push(args[0]); return null;
      case "pop": {
        if (!self.length) throw new LangError("pop() из пустого списка", line);
        const i = args.length ? normIndex(num(args[0], line), self.length, line) : self.length - 1;
        return self.splice(i, 1)[0];
      }
      case "insert": self.splice(num(args[0], line), 0, args[1]); return null;
      case "remove": {
        const i = self.findIndex((x) => equals(x, args[0]));
        if (i < 0) throw new LangError("remove(): элемента нет в списке", line);
        self.splice(i, 1);
        return null;
      }
      case "index": {
        const i = self.findIndex((x) => equals(x, args[0]));
        if (i < 0) throw new LangError("index(): элемента нет в списке", line);
        return i;
      }
      case "count": return self.filter((x) => equals(x, args[0])).length;
      case "reverse": self.reverse(); return null;
      case "sort": self.sort((a, b) => compare(a, b, line)); return null;
    }
  }
  if (self instanceof PyDict) {
    switch (name) {
      case "keys": return [...self.map.values()].map(([k]) => k);
      case "values": return [...self.map.values()].map(([, v]) => v);
      case "items": return [...self.map.values()].map(([k, v]) => new Tuple([k, v]));
      case "get": return self.map.get(keyOf(args[0], line))?.[1] ?? (args[1] ?? null);
      case "pop": {
        const k = keyOf(args[0], line);
        const hit = self.map.get(k);
        if (!hit) throw new LangError(`Ключа ${repr(args[0], false)} нет в словаре`, line);
        self.map.delete(k);
        return hit[1];
      }
    }
  }
  throw new LangError(`У значения типа ${typeName(self)} нет метода «${name}»`, line);
}

/** Встроенные функции языка, не связанные с миром игры. */
export function pureBuiltins(): Map<string, Value> {
  const m = new Map<string, Value>();
  const def = (name: string, f: (a: Value[], line: number) => Value) => m.set(name, new HostFunc(name, f));
  def("range", (a, line) => {
    const n = a.map((x) => num(x, line));
    if (n.length === 1) return new Range(0, n[0], 1);
    if (n[2] === 0) throw new LangError("Шаг range не может быть 0", line);
    return new Range(n[0], n[1], n[2] ?? 1);
  });
  def("len", ([v], line) => {
    if (typeof v === "string" || Array.isArray(v)) return v.length;
    if (v instanceof Tuple) return v.items.length;
    if (v instanceof PyDict) return v.map.size;
    if (v instanceof Range) return v.length;
    throw new LangError(`У значения типа ${typeName(v)} нет длины`, line);
  });
  def("abs", ([v], line) => Math.abs(num(v, line)));
  const pick = (sign: number) => (a: Value[], line: number) => {
    const items = a.length === 1 ? [...iterate(a[0], line)] : a;
    if (!items.length) throw new LangError("Пустая последовательность", line);
    return items.reduce((best, x) => (compare(x, best, line) * sign > 0 ? x : best));
  };
  def("min", pick(-1));
  def("max", pick(1));
  def("sum", ([v], line) => [...iterate(v, line)].reduce<number>((s, x) => s + num(x, line), 0));
  def("str", ([v]) => repr(v ?? ""));
  def("int", ([v], line) => {
    const n = typeof v === "string" ? Number(v) : num(v, line);
    if (Number.isNaN(n)) throw new LangError(`Не число: ${repr(v, false)}`, line);
    return Math.trunc(n);
  });
  def("float", ([v], line) => (typeof v === "string" ? Number(v) : num(v, line)));
  def("bool", ([v]) => truthy(v ?? null));
  def("round", ([v, d], line) => {
    const k = 10 ** (d === undefined ? 0 : num(d, line));
    return Math.round(num(v, line) * k) / k;
  });
  def("list", ([v], line) => (v === undefined ? [] : [...iterate(v, line)]));
  def("tuple", ([v], line) => new Tuple(v === undefined ? [] : [...iterate(v, line)]));
  def("dict", () => new PyDict());
  def("sorted", ([v], line) => [...iterate(v, line)].sort((a, b) => compare(a, b, line)));
  def("random", () => Math.random());
  return m;
}
