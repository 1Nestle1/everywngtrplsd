import { VM, sumLoopProgram } from "./vm";

export interface BenchResult {
  name: string;
  ms: number;
  /** Итераций цикла игрока в секунду. */
  itersPerSec: number;
}

const now = () => performance.now();

function nativeLoop(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += i;
  return s;
}

function vmLoop(n: number, slice: number): number {
  const vm = new VM(sumLoopProgram(n));
  while (vm.run(slice) !== "halt");
  return vm.vars[1];
}

function measure(name: string, n: number, fn: () => number): BenchResult {
  fn(); // прогрев JIT
  const t0 = now();
  const value = fn();
  const ms = now() - t0;
  if (value !== (n * (n - 1)) / 2) throw new Error(`${name}: wrong result ${value}`);
  return { name, ms, itersPerSec: n / (ms / 1000) };
}

export function runBench(n = 5_000_000): BenchResult[] {
  return [
    measure("Нативный JS (верхняя граница)", n, () => nativeLoop(n)),
    measure("Своя VM, порции по 100 000 инструкций", n, () => vmLoop(n, 100_000)),
    measure("Своя VM, порции по 1 000 инструкций", n, () => vmLoop(n, 1_000)),
  ];
}

export function formatBench(results: BenchResult[]): string {
  return results
    .map((r) => `${r.name.padEnd(40)} ${r.ms.toFixed(1).padStart(8)} мс  ${(r.itersPerSec / 1e6).toFixed(1).padStart(7)} M итераций/с`)
    .join("\n");
}
