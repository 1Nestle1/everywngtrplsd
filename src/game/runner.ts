// Исполнитель программы дрона: крутит генератор интерпретатора по бюджету тиков
// и переводит вызовы игровых функций в действия мира.

import {
  DIRECTIONS, ENTITIES, ENUM_UNLOCKS, FN_BY_NAME, FUNCTIONS, GROUNDS, ITEMS, LANG_UNLOCKS, UNLOCK_BY_ID,
  type Dir, type Entity, type Item,
} from "./api";
import {
  EnumVal, HostFunc, Interpreter, LangError, Namespace, Tuple, pureBuiltins, repr, type Host, type Value, type Yielded,
} from "./lang/interp";
import type { World } from "./world";

/** Базовая скорость: тиков в секунду. Обычное действие стоит 200 тиков. */
export const TICKS_PER_SECOND = 1000;

export type RunState = "idle" | "running" | "paused";

export interface RunnerCallbacks {
  getSource(file: string): string | null;
  onOutput(text: string, kind: "out" | "err" | "info"): void;
  onStateChange(state: RunState, file: string | null): void;
}

const ENUMS = {
  Entities: ENTITIES as readonly string[],
  Items: ITEMS as readonly string[],
  Grounds: GROUNDS as readonly string[],
};
const enumCache = new Map<string, EnumVal>();
function enumVal(group: string, name: string): EnumVal {
  const key = group + "." + name;
  let v = enumCache.get(key);
  if (!v) enumCache.set(key, (v = new EnumVal(group, name)));
  return v;
}

function unlockName(id: string): string {
  return id
    .split("|")
    .map((u) => `«${UNLOCK_BY_ID.get(u)?.ru ?? u}»`)
    .join(" или ");
}

export class Runner {
  state: RunState = "idle";
  file: string | null = null;
  line = 0;
  lineFile = "";
  ticks = 0;
  private gen: Generator<Yielded, void, Value> | null = null;
  private pending: Value = null;
  private budget = 0;
  private builtins = new Map<string, Value>();

  constructor(private world: World, private cb: RunnerCallbacks) {
    this.rebuildBuiltins();
  }

  /** Собирает словарь доступных имён по текущим разблокировкам. */
  rebuildBuiltins(): void {
    const w = this.world;
    const m = this.builtins;
    m.clear();
    for (const [k, v] of pureBuiltins()) m.set(k, v);
    for (const f of FUNCTIONS) if (w.has(f.unlock)) m.set(f.name, new HostFunc(f.name));
    for (const [group, names] of Object.entries(ENUMS)) {
      const members = new Map<string, Value>();
      for (const n of names) {
        const u = ENUM_UNLOCKS[`${group}.${n}`];
        if (!u || w.has(u)) members.set(n, enumVal(group, n));
      }
      m.set(group, new Namespace(group, members));
    }
    for (const d of DIRECTIONS) if (w.has(ENUM_UNLOCKS[d])) m.set(d, enumVal("", d));
  }

  private host(): Host {
    const w = this.world;
    return {
      builtins: this.builtins,
      getSource: (name) => this.cb.getSource(name),
      lockedHint: (name) => {
        const f = FN_BY_NAME.get(name);
        if (f) return `${name}() пока недоступна — изучите навык ${unlockName(f.unlock)}`;
        const u = ENUM_UNLOCKS[name];
        if (u) return `${name} пока недоступно — изучите навык ${unlockName(u)}`;
        return null;
      },
      checkFeatures: (f) => {
        for (const l of LANG_UNLOCKS) {
          if (f[l.feature] && !w.has(l.unlock))
            throw new LangError(`${l.ru} пока недоступны — изучите навык ${unlockName(l.unlock)}`, f[l.feature]);
        }
      },
    };
  }

  start(file: string, paused = false): void {
    this.stop(true);
    const src = this.cb.getSource(file);
    if (src === null) return;
    this.rebuildBuiltins();
    const interp = new Interpreter(this.host());
    this.gen = interp.run(file, src);
    this.file = file;
    this.pending = null;
    this.budget = 0;
    this.ticks = 0;
    this.line = 0;
    this.lineFile = file;
    this.setState(paused ? "paused" : "running");
  }

  stop(silent = false): void {
    if (this.state === "idle") return;
    this.gen = null;
    if (!silent) this.cb.onOutput("Программа остановлена", "info");
    this.setState("idle");
  }

  pause(): void {
    if (this.state === "running") this.setState("paused");
  }
  resume(): void {
    if (this.state === "paused") this.setState("running");
  }

  /** Выполнить одну инструкцию (до следующей строки). */
  step(file: string): void {
    if (this.state === "idle") {
      // первая остановка — на первой строке программы, до её выполнения
      this.start(file, true);
      this.advance(Infinity, true);
      return;
    }
    this.setState("paused");
    this.advance(Infinity, true);
  }

  private setState(s: RunState): void {
    this.state = s;
    this.cb.onStateChange(s, this.file);
  }

  update(dt: number): void {
    if (this.state !== "running") return;
    this.budget = Math.min(this.budget + dt * TICKS_PER_SECOND * this.world.speed, 4000);
    this.advance(this.budget, false);
  }

  /** Крутит генератор, пока хватает бюджета. В режиме шага — до следующей строки. */
  private advance(budget: number, stepMode: boolean): void {
    if (!this.gen) return;
    let guard = 0;
    try {
      while (this.gen && (stepMode || this.budget > 0) && guard++ < 200_000) {
        const r = this.gen.next(this.pending);
        this.pending = null;
        if (r.done) {
          this.cb.onOutput(`Программа «${this.file}» завершена`, "info");
          this.gen = null;
          this.setState("idle");
          return;
        }
        const y = r.value;
        if (y.kind === "tick") {
          this.ticks++;
          if (!stepMode) this.budget -= 1;
          this.line = y.line;
          this.lineFile = y.file;
          if (stepMode) return;
        } else {
          const cost = FN_BY_NAME.get(y.name)?.ticks ?? 1;
          this.ticks += cost;
          if (!stepMode) this.budget -= cost;
          this.pending = this.call(y.name, y.args, y.line);
        }
      }
    } catch (e) {
      const err = e as LangError & { file?: string };
      const where = err instanceof LangError ? ` (${err.file || this.file}, строка ${err.line})` : "";
      if (err instanceof LangError) {
        this.line = err.line;
        this.lineFile = err.file || this.file || "";
      }
      this.cb.onOutput(`Ошибка${where}: ${err.message}`, "err");
      this.gen = null;
      this.setState("idle");
    }
    void budget;
  }

  // --- Игровые функции ---
  private call(name: string, a: Value[], line: number): Value {
    const w = this.world;
    const dir = (v: Value): Dir => {
      if (v instanceof EnumVal && v.group === "" && (DIRECTIONS as readonly string[]).includes(v.name)) return v.name as Dir;
      throw new LangError(`${name}(): ожидалось направление North/East/South/West, получено ${repr(v, false)}`, line);
    };
    const en = (v: Value, group: string): string => {
      if (v instanceof EnumVal && v.group === group) return v.name;
      throw new LangError(`${name}(): ожидалось ${group}.…, получено ${repr(v, false)}`, line);
    };
    switch (name) {
      case "print": {
        const text = a.map((x) => repr(x)).join(" ");
        this.cb.onOutput(text, "out");
        w.events.push({ type: "print", text });
        return null;
      }
      case "harvest": return w.harvest();
      case "do_a_flip": w.events.push({ type: "flip" }); return null;
      case "move": return w.move(dir(a[0]));
      case "can_move": return w.canMove(dir(a[0]));
      case "get_world_size": return w.size;
      case "plant": return w.plant(en(a[0], "Entities") as Entity);
      case "can_harvest": return w.canHarvest();
      case "get_entity_type": {
        const e = w.cell().entity;
        return e ? enumVal("Entities", e) : null;
      }
      case "get_ground_type": return enumVal("Grounds", w.cell().ground);
      case "get_pos_x": return w.drone.x;
      case "get_pos_y": return w.drone.y;
      case "num_items": return Math.floor(w.inventory[en(a[0], "Items") as Item]);
      case "get_time": return Math.round(w.time * 100) / 100;
      case "get_tick_count": return this.ticks;
      case "clear": w.clear(); return null;
      case "till": return w.till();
      case "use_item": return w.useItem(en(a[0], "Items") as Item, a[1] === undefined ? 1 : Number(a[1]));
      case "get_water": return Math.round(w.cell().water * 100) / 100;
      case "measure": {
        const r = w.measure(a[0] === undefined || a[0] === null ? null : dir(a[0]));
        return Array.isArray(r) ? new Tuple(r) : r;
      }
      case "swap": return w.swap(dir(a[0]));
    }
    throw new LangError(`Неизвестная функция ${name}`, line);
  }
}
