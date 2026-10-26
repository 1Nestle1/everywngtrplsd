import { VM, assemble } from "./vm";

// Симуляция мира без отрисовки: поле, рост ресурса, дроны с байткодом.
// Общая для 2D- и 3D-демо, чтобы сравнивать только стоимость рендера.

const ACT_HARVEST = 0;
const ACT_MOVE = 1;
const EAST = 0;
const NORTH = 1;

// Программа дрона: идёт змейкой по строке и собирает урожай, в конце строки — на север.
//   while True:
//     harvest(); move(East); i += 1
//     if not (i < W): i = 0; move(North)
export function droneProgram(width: number): number[] {
  return assemble([
    "loop:",
    ["PUSH", 0], ["ACT", ACT_HARVEST], ["POP"],
    ["PUSH", EAST], ["ACT", ACT_MOVE], ["POP"],
    ["LOAD", 0], ["PUSH", 1], ["ADD"], ["STORE", 0],
    ["LOAD", 0], ["PUSH", width], ["LT"], ["JZ", "nextRow"],
    ["JMP", "loop"],
    "nextRow:",
    ["PUSH", 0], ["STORE", 0],
    ["PUSH", NORTH], ["ACT", ACT_MOVE], ["POP"],
    ["JMP", "loop"],
  ]);
}

export interface Drone {
  vm: VM;
  x: number;
  y: number;
  /** Клетка, с которой дрон начал последний шаг, — для плавной анимации. */
  fromX: number;
  fromY: number;
  cooldown: number;
}

const VM_BUDGET_PER_DRONE = 10_000;

export class Sim {
  readonly growth: Float32Array;
  drones: Drone[] = [];
  harvested = 0;
  private readonly program: number[];

  constructor(readonly width: number, readonly height: number) {
    this.growth = new Float32Array(width * height);
    this.program = droneProgram(width);
  }

  spawn(count: number): void {
    const { width: W, height: H } = this;
    this.drones = Array.from({ length: count }, (_, k) => {
      const x = k % W;
      const y = Math.floor(k / W) % H;
      return { vm: new VM(this.program), x, y, fromX: x, fromY: y, cooldown: 0 };
    });
  }

  step(dt: number, actionsPerSec: number): void {
    const g = this.growth;
    for (let i = 0; i < g.length; i++) g[i] = Math.min(1, g[i] + dt * 0.2);

    const actionTime = 1 / actionsPerSec;
    for (const d of this.drones) {
      d.cooldown -= dt;
      while (d.cooldown <= 0) {
        if (d.vm.pendingAction >= 0) {
          d.vm.resume(this.doAction(d, d.vm.pendingAction, d.vm.pendingArg));
          d.cooldown += actionTime;
        }
        if (d.vm.run(VM_BUDGET_PER_DRONE) !== "action") break;
      }
    }
  }

  /** Доля пройденного шага (0..1) — для интерполяции позиции в рендере. */
  progress(d: Drone, actionsPerSec: number): number {
    return Math.min(1, Math.max(0, 1 - d.cooldown * actionsPerSec));
  }

  private doAction(d: Drone, id: number, arg: number): number {
    if (id === ACT_HARVEST) {
      const i = d.y * this.width + d.x;
      if (this.growth[i] >= 1) {
        this.growth[i] = 0;
        this.harvested++;
        return 1;
      }
      return 0;
    }
    d.fromX = d.x;
    d.fromY = d.y;
    if (arg === EAST) d.x = (d.x + 1) % this.width;
    else d.y = (d.y + 1) % this.height;
    return 1;
  }
}
