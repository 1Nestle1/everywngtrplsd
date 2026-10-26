// Минимальная стековая VM для кода игрока.
// Идея: код игрока компилируется в байткод, а игра исполняет его порциями
// (budget инструкций за кадр). Так бесконечный цикл игрока не вешает вкладку,
// а «действия» (move, harvest) останавливают VM, пока игра их не отыграет.

export const Op = {
  PUSH: 0, // PUSH <const>
  POP: 1,
  LOAD: 2, // LOAD <var>
  STORE: 3, // STORE <var>
  ADD: 4,
  SUB: 5,
  MUL: 6,
  LT: 7,
  EQ: 8,
  JMP: 9, // JMP <addr>
  JZ: 10, // JZ <addr>
  ACT: 11, // ACT <actionId>: снимает аргумент со стека и уступает управление игре
  HALT: 12,
} as const;

export type RunResult = "budget" | "action" | "halt";

export class VM {
  readonly code: Int32Array;
  pc = 0;
  sp = 0;
  readonly stack = new Float64Array(256);
  readonly vars = new Float64Array(64);
  /** Сколько инструкций выполнено всего — для подсчёта ops/sec. */
  executed = 0;
  pendingAction = -1;
  pendingArg = 0;

  constructor(code: ArrayLike<number>) {
    this.code = Int32Array.from(code);
  }

  /** Результат действия кладётся на стек, VM продолжает со следующей инструкции. */
  resume(result: number): void {
    this.stack[this.sp++] = result;
    this.pendingAction = -1;
  }

  run(budget: number): RunResult {
    const code = this.code;
    const stack = this.stack;
    const vars = this.vars;
    let pc = this.pc;
    let sp = this.sp;
    let n = 0;
    let result: RunResult = "budget";

    while (n < budget) {
      n++;
      const op = code[pc++];
      switch (op) {
        case Op.PUSH:
          stack[sp++] = code[pc++];
          break;
        case Op.POP:
          sp--;
          break;
        case Op.LOAD:
          stack[sp++] = vars[code[pc++]];
          break;
        case Op.STORE:
          vars[code[pc++]] = stack[--sp];
          break;
        case Op.ADD:
          sp--;
          stack[sp - 1] += stack[sp];
          break;
        case Op.SUB:
          sp--;
          stack[sp - 1] -= stack[sp];
          break;
        case Op.MUL:
          sp--;
          stack[sp - 1] *= stack[sp];
          break;
        case Op.LT:
          sp--;
          stack[sp - 1] = stack[sp - 1] < stack[sp] ? 1 : 0;
          break;
        case Op.EQ:
          sp--;
          stack[sp - 1] = stack[sp - 1] === stack[sp] ? 1 : 0;
          break;
        case Op.JMP:
          pc = code[pc];
          break;
        case Op.JZ:
          pc = stack[--sp] === 0 ? code[pc] : pc + 1;
          break;
        case Op.ACT:
          this.pendingAction = code[pc++];
          this.pendingArg = stack[--sp];
          result = "action";
          break;
        case Op.HALT:
          pc--;
          result = "halt";
          break;
        default:
          throw new Error(`Unknown opcode ${op} at ${pc - 1}`);
      }
      if (result !== "budget") break;
    }

    this.pc = pc;
    this.sp = sp;
    this.executed += n;
    return result;
  }
}

/** Ассемблер с метками: строки вида "L:" задают метку, ["JMP", "L"] — переход на неё. */
export function assemble(lines: (string | [string, (string | number)?])[]): number[] {
  const labels = new Map<string, number>();
  let addr = 0;
  for (const line of lines) {
    if (typeof line === "string") labels.set(line.slice(0, -1), addr);
    else addr += line.length;
  }
  const out: number[] = [];
  for (const line of lines) {
    if (typeof line === "string") continue;
    const [name, arg] = line;
    const op = (Op as Record<string, number>)[name];
    if (op === undefined) throw new Error(`Unknown op ${name}`);
    out.push(op);
    if (arg !== undefined) {
      if (typeof arg === "number") out.push(arg);
      else {
        const target = labels.get(arg);
        if (target === undefined) throw new Error(`Unknown label ${arg}`);
        out.push(target);
      }
    }
  }
  return out;
}

/** Цикл `s = 0; i = 0; while i < n: s += i; i += 1` — эталон для бенчмарка. */
export function sumLoopProgram(n: number): number[] {
  // vars: 0 = i, 1 = s
  return assemble([
    "loop:",
    ["LOAD", 0], ["PUSH", n], ["LT"], ["JZ", "end"],
    ["LOAD", 1], ["LOAD", 0], ["ADD"], ["STORE", 1],
    ["LOAD", 0], ["PUSH", 1], ["ADD"], ["STORE", 0],
    ["JMP", "loop"],
    "end:",
    ["HALT"],
  ]);
}
