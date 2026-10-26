// Модель мира: поле астероида, растения, склад, исследования и действия дрона.
// Рендер и интерфейс только читают отсюда состояние.

import {
  type Dir, type Entity, type Ground, type Item, ITEMS, PLANTS, SPEEDS, UNLOCK_BY_ID, WORLD_SIZES,
} from "./api";

export interface Cell {
  ground: Ground;
  entity: Entity | null;
  progress: number; // 0..1, 1 — созрело
  growTime: number;
  water: number; // 0..1
  value: number; // лепестки солнечника или размер призмы
}

export interface Maze {
  walls: Set<string>; // "x,y,dir" — стена с этой стороны клетки
  treasure: [number, number];
}

const DX: Record<Dir, number> = { North: 0, East: 1, South: 0, West: -1 };
const DY: Record<Dir, number> = { North: 1, East: 0, South: -1, West: 0 };
const OPP: Record<Dir, Dir> = { North: "South", South: "North", East: "West", West: "East" };

export type WorldEvent =
  | { type: "harvest"; x: number; y: number; item: Item; amount: number }
  | { type: "flip" }
  | { type: "print"; text: string }
  | { type: "unlock"; id: string }
  | { type: "maze" }
  | { type: "win" };

export class World {
  size = 1;
  cells: Cell[] = [];
  drone = { x: 0, y: 0 };
  inventory = Object.fromEntries(ITEMS.map((i) => [i, 0])) as Record<Item, number>;
  unlocks: Record<string, number> = {};
  maze: Maze | null = null;
  time = 0;
  /** Растёт при каждом изменении поля, рендер по нему понимает, что перерисовать. */
  version = 0;
  events: WorldEvent[] = [];
  won = false;
  private regen = 0;

  constructor() {
    this.resize(1);
  }

  level(id: string): number {
    return this.unlocks[id] ?? 0;
  }
  has(id: string): boolean {
    return id === "start" || id.split("|").some((u) => this.level(u) > 0);
  }

  get speed(): number {
    return SPEEDS[this.level("speed")] * (this.inventory.Power >= 1 ? 2 : 1);
  }

  resize(n: number): void {
    const old = this.cells;
    const oldSize = this.size;
    this.size = n;
    this.cells = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        this.cells.push(x < oldSize && y < oldSize && old.length ? old[y * oldSize + x] : this.emptyCell());
      }
    this.maze = null;
    this.drone.x %= n;
    this.drone.y %= n;
    this.version++;
  }

  private emptyCell(): Cell {
    return { ground: "Rock", entity: "Moss", progress: 0, growTime: PLANTS.Moss!.grow, water: 0, value: 0 };
  }

  cell(x = this.drone.x, y = this.drone.y): Cell {
    return this.cells[y * this.size + x];
  }

  // --- Время ---
  update(dt: number): void {
    this.time += dt;
    for (const c of this.cells) {
      if (c.water > 0) c.water = Math.max(0, c.water - dt * 0.015);
      if (!c.entity && c.ground === "Rock" && !this.maze) {
        c.entity = "Moss";
        c.progress = 0;
        c.growTime = PLANTS.Moss!.grow;
        this.version++;
      }
      if (c.entity && c.progress < 1 && PLANTS[c.entity]) {
        c.progress = Math.min(1, c.progress + (dt / c.growTime) * (1 + 4 * c.water));
        if (c.progress >= 1) {
          if (c.entity === "Geode" && Math.random() < 0.2) c.entity = "Dead_Geode";
          this.version++;
        }
      }
    }
    // Лёд и наниты копятся сами, когда открыты.
    this.regen += dt;
    if (this.regen >= 1) {
      this.regen -= 1;
      if (this.has("watering") && this.inventory.Water < 100) this.inventory.Water += 1;
      if (this.has("maze") && this.inventory.Nanites < 200) this.inventory.Nanites += 1;
    }
  }

  // --- Исследования ---
  unlockCost(id: string): Partial<Record<Item, number>> | null {
    const spec = UNLOCK_BY_ID.get(id)!;
    return spec.costs[this.level(id)] ?? null;
  }
  canAfford(cost: Partial<Record<Item, number>>): boolean {
    return Object.entries(cost).every(([k, v]) => this.inventory[k as Item] >= (v ?? 0));
  }
  visibleUnlock(id: string): boolean {
    return UNLOCK_BY_ID.get(id)!.requires.every((r) => this.has(r));
  }
  buyUnlock(id: string): boolean {
    const cost = this.unlockCost(id);
    if (!cost || !this.visibleUnlock(id) || !this.canAfford(cost)) return false;
    for (const [k, v] of Object.entries(cost)) this.inventory[k as Item] -= v ?? 0;
    this.applyUnlock(id);
    return true;
  }
  applyUnlock(id: string): void {
    this.unlocks[id] = this.level(id) + 1;
    if (id === "expand") this.resize(WORLD_SIZES[this.level("expand")]);
    if (id === "beacon") {
      this.won = true;
      this.events.push({ type: "win" });
    }
    this.events.push({ type: "unlock", id });
    this.version++;
  }

  // --- Действия дрона. Возвращают значение для кода игрока ---
  private usePower(): void {
    if (this.inventory.Power >= 1) this.inventory.Power = Math.max(0, this.inventory.Power - 1 / 30);
  }

  private neighbor(dir: Dir, wrap = true): [number, number] | null {
    let x = this.drone.x + DX[dir];
    let y = this.drone.y + DY[dir];
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) {
      if (!wrap) return null;
      x = (x + this.size) % this.size;
      y = (y + this.size) % this.size;
    }
    return [x, y];
  }

  canMove(dir: Dir): boolean {
    if (!this.maze) return true;
    if (this.maze.walls.has(`${this.drone.x},${this.drone.y},${dir}`)) return false;
    return this.neighbor(dir, false) !== null;
  }

  move(dir: Dir): boolean {
    this.usePower();
    if (!this.canMove(dir)) return false;
    const n = this.neighbor(dir)!;
    this.drone.x = n[0];
    this.drone.y = n[1];
    return true;
  }

  canHarvest(): boolean {
    const c = this.cell();
    if (this.maze) return c.entity === "Treasure";
    return !!c.entity && c.entity !== "Dead_Geode" && c.progress >= 1;
  }

  harvest(): boolean {
    this.usePower();
    const c = this.cell();
    const { x, y } = this.drone;
    if (this.maze) {
      const isTreasure = c.entity === "Treasure";
      if (isTreasure) this.give("Gold", this.size * this.size * 2, x, y);
      this.clearMaze();
      return isTreasure;
    }
    if (!c.entity) return false;
    // незрелый мох не портится — иначе первый цикл «while True: harvest()» ничего бы не давал
    if (c.entity === "Moss" && c.progress < 1) return false;
    if (c.progress < 1 || c.entity === "Dead_Geode") {
      this.clearCell(c);
      return false;
    }
    switch (c.entity) {
      case "Pillar":
        this.give("Silicon", 5, x, y);
        break;
      case "Geode": {
        const group = this.geodeGroups().get(y * this.size + x);
        const k = group?.k ?? 1;
        const [ax, ay] = group ? [group.x, group.y] : [x, y];
        for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) this.clearCell(this.cell(ax + i, ay + j));
        this.give("Gems", k >= 6 ? k * k * 6 : k * k * k, x, y);
        return true;
      }
      case "Solar": {
        const flowers = this.cells.filter((o) => o.entity === "Solar" && o.progress >= 1);
        const best = Math.max(...flowers.map((o) => o.value));
        this.give("Power", flowers.length >= 10 && c.value === best ? 8 : 1, x, y);
        break;
      }
      case "Prism": {
        const group = this.prismGroup(x, y);
        if (this.prismSorted(group)) {
          for (const idx of group) this.clearCell(this.cells[idx]);
          this.give("Crystal", group.size * group.size, x, y);
          return true;
        }
        this.give("Crystal", 1, x, y);
        break;
      }
      default:
        this.give(PLANTS[c.entity]!.yields!, 1, x, y);
    }
    this.clearCell(c);
    return true;
  }

  private give(item: Item, amount: number, x: number, y: number): void {
    this.inventory[item] += amount;
    this.events.push({ type: "harvest", x, y, item, amount });
  }

  private clearCell(c: Cell): void {
    c.entity = null;
    c.progress = 0;
    c.value = 0;
    this.version++;
  }

  plant(e: Entity): boolean {
    this.usePower();
    const spec = PLANTS[e];
    const c = this.cell();
    if (!spec || this.maze || !this.has(spec.unlock)) return false;
    if (c.entity && c.entity !== "Moss" && c.entity !== "Dead_Geode") return false;
    if (c.entity === e) return false;
    if (!spec.ground.includes(c.ground)) return false;
    if (!this.canAfford(spec.cost)) return false;
    for (const [k, v] of Object.entries(spec.cost)) this.inventory[k as Item] -= v ?? 0;
    c.entity = e;
    c.progress = 0;
    c.growTime = spec.grow * (0.8 + Math.random() * 0.4);
    if (e === "Pillar") {
      for (const d of ["North", "East", "South", "West"] as Dir[]) {
        const [nx, ny] = this.neighbor(d)!;
        if (this.cell(nx, ny).entity === "Pillar") c.growTime *= 2;
      }
    }
    if (e === "Solar") c.value = 7 + Math.floor(Math.random() * 9);
    if (e === "Prism") c.value = Math.floor(Math.random() * 10);
    this.version++;
    return true;
  }

  till(): boolean {
    this.usePower();
    if (this.maze) return false;
    const c = this.cell();
    c.ground = c.ground === "Rock" ? "Dust" : "Rock";
    this.clearCell(c);
    return true;
  }

  useItem(item: Item, n: number): boolean {
    this.usePower();
    if (!Number.isInteger(n) || n < 1 || this.inventory[item] < n) return false;
    const c = this.cell();
    if (item === "Water") {
      c.water = Math.min(1, c.water + 0.25 * n);
      this.inventory.Water -= n;
      this.version++;
      return true;
    }
    if (item === "Nanites") {
      if (this.maze || c.entity !== "Shard" || c.progress < 1 || n < this.size) return false;
      this.inventory.Nanites -= n;
      this.buildMaze();
      return true;
    }
    return false;
  }

  measure(dir: Dir | null): number | [number, number] | null {
    if (this.maze) return this.maze.treasure;
    const [x, y] = dir ? this.neighbor(dir)! : [this.drone.x, this.drone.y];
    const c = this.cell(x, y);
    if (c.entity === "Solar" || c.entity === "Prism") return c.value;
    return null;
  }

  swap(dir: Dir): boolean {
    this.usePower();
    if (this.maze) return false;
    const [x, y] = this.neighbor(dir)!;
    const a = this.cell();
    const b = this.cell(x, y);
    for (const k of ["entity", "progress", "growTime", "value"] as const) {
      const t = a[k];
      (a as unknown as Record<string, unknown>)[k] = b[k];
      (b as unknown as Record<string, unknown>)[k] = t;
    }
    this.version++;
    return true;
  }

  clear(): void {
    this.maze = null;
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = this.emptyCell();
    this.drone.x = 0;
    this.drone.y = 0;
    this.version++;
  }

  // --- Жеоды: жадно ищем самые большие квадраты из целых созревших жеод ---
  geodeGroups(): Map<number, { x: number; y: number; k: number }> {
    const n = this.size;
    const ok = (x: number, y: number) => {
      const c = this.cells[y * n + x];
      return c.entity === "Geode" && c.progress >= 1;
    };
    const cands: { x: number; y: number; k: number }[] = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let k = 0;
        outer: while (x + k < n && y + k < n) {
          for (let i = 0; i <= k; i++) if (!ok(x + k, y + i) || !ok(x + i, y + k)) break outer;
          k++;
        }
        if (k >= 1) cands.push({ x, y, k });
      }
    cands.sort((a, b) => b.k - a.k);
    const out = new Map<number, { x: number; y: number; k: number }>();
    for (const c of cands) {
      // квадрат может частично пересекаться с уже занятыми — уменьшаем его
      let k = c.k;
      while (k > 0) {
        let free = true;
        for (let j = 0; j < k && free; j++) for (let i = 0; i < k; i++) if (out.has((c.y + j) * n + c.x + i)) { free = false; break; }
        if (free) break;
        k--;
      }
      if (k < 1 || out.has(c.y * n + c.x)) continue;
      const g = { x: c.x, y: c.y, k };
      for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) out.set((c.y + j) * n + c.x + i, g);
    }
    return out;
  }

  // --- Призмы ---
  private prismGroup(x: number, y: number): Set<number> {
    const n = this.size;
    const seen = new Set<number>();
    const stack = [y * n + x];
    while (stack.length) {
      const i = stack.pop()!;
      if (seen.has(i)) continue;
      const c = this.cells[i];
      if (c.entity !== "Prism" || c.progress < 1) continue;
      seen.add(i);
      const cx = i % n, cy = Math.floor(i / n);
      if (cx > 0) stack.push(i - 1);
      if (cx < n - 1) stack.push(i + 1);
      if (cy > 0) stack.push(i - n);
      if (cy < n - 1) stack.push(i + n);
    }
    return seen;
  }
  private prismSorted(group: Set<number>): boolean {
    const n = this.size;
    for (const i of group) {
      const v = this.cells[i].value;
      if (i % n < n - 1 && group.has(i + 1) && this.cells[i + 1].value < v) return false;
      if (group.has(i + n) && this.cells[i + n].value < v) return false;
    }
    return true;
  }

  // --- Лабиринт: случайный обход в глубину ---
  private buildMaze(): void {
    const n = this.size;
    const walls = new Set<string>();
    const dirs: Dir[] = ["North", "East", "South", "West"];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (const d of dirs) walls.add(`${x},${y},${d}`);
    const seen = new Set<number>([this.drone.y * n + this.drone.x]);
    const stack: [number, number][] = [[this.drone.x, this.drone.y]];
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const opts = dirs.filter((d) => {
        const nx = x + DX[d], ny = y + DY[d];
        return nx >= 0 && ny >= 0 && nx < n && ny < n && !seen.has(ny * n + nx);
      });
      if (!opts.length) {
        stack.pop();
        continue;
      }
      const d = opts[Math.floor(Math.random() * opts.length)];
      const nx = x + DX[d], ny = y + DY[d];
      walls.delete(`${x},${y},${d}`);
      walls.delete(`${nx},${ny},${OPP[d]}`);
      seen.add(ny * n + nx);
      stack.push([nx, ny]);
    }
    let tx: number, ty: number;
    do {
      tx = Math.floor(Math.random() * n);
      ty = Math.floor(Math.random() * n);
    } while (n > 1 && tx === this.drone.x && ty === this.drone.y);
    this.maze = { walls, treasure: [tx, ty] };
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      c.entity = i === ty * n + tx ? "Treasure" : "Hedge";
      c.progress = 1;
      c.value = 0;
    }
    this.events.push({ type: "maze" });
    this.version++;
  }

  private clearMaze(): void {
    this.maze = null;
    for (const c of this.cells) {
      c.entity = null;
      c.progress = 0;
    }
    this.version++;
  }

  // --- Сохранение ---
  toJSON(): unknown {
    return {
      size: this.size, cells: this.cells, drone: this.drone, inventory: this.inventory,
      unlocks: this.unlocks, time: this.time, won: this.won,
    };
  }
  load(d: ReturnType<World["toJSON"]>): void {
    const s = d as World;
    this.size = s.size;
    this.cells = s.cells.map((c) => (c.entity === "Hedge" || c.entity === "Treasure" ? { ...c, entity: null, progress: 0 } : c));
    this.drone = s.drone;
    Object.assign(this.inventory, s.inventory);
    this.unlocks = s.unlocks;
    this.time = s.time;
    this.won = s.won;
    this.version++;
  }
}
