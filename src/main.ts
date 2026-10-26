import { formatBench, runBench } from "./bench";
import { Sim } from "./sim";
import "./style.css";

// Прототип: поле, по которому ходят дроны, управляемые байткодом.
// Нужен, чтобы проверить производительность веба, а не как геймплей.

const W = 32;
const H = 32;
const CELL = 16;

const sim = new Sim(W, H);

// --- UI ---
const canvas = document.querySelector<HTMLCanvasElement>("#field")!;
canvas.width = W * CELL;
canvas.height = H * CELL;
const ctx = canvas.getContext("2d")!;
const stats = document.querySelector<HTMLPreElement>("#stats")!;
const speedInput = document.querySelector<HTMLInputElement>("#speed")!;
const dronesInput = document.querySelector<HTMLInputElement>("#drones")!;
const benchBtn = document.querySelector<HTMLButtonElement>("#bench")!;
const benchOut = document.querySelector<HTMLPreElement>("#benchOut")!;

dronesInput.addEventListener("change", () => sim.spawn(Number(dronesInput.value)));
benchBtn.addEventListener("click", () => {
  benchOut.textContent = "Считаю…";
  setTimeout(() => (benchOut.textContent = formatBench(runBench())), 20);
});

sim.spawn(Number(dronesInput.value));

let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let fps = 0;
let opsAtLastSecond = 0;
let opsPerSec = 0;
let simMs = 0;

function frame(t: number): void {
  const dt = Math.min((t - last) / 1000, 0.1);
  last = t;

  const s0 = performance.now();
  sim.step(dt, Number(speedInput.value));
  simMs = performance.now() - s0;

  const growth = sim.growth;
  for (let i = 0; i < growth.length; i++) {
    const g = growth[i];
    ctx.fillStyle = g >= 1 ? "#d9b44a" : `rgb(40, ${Math.floor(60 + g * 120)}, 50)`;
    ctx.fillRect((i % W) * CELL, Math.floor(i / W) * CELL, CELL - 1, CELL - 1);
  }
  ctx.fillStyle = "#4ad9ff";
  for (const d of sim.drones) ctx.fillRect(d.x * CELL + 4, d.y * CELL + 4, CELL - 9, CELL - 9);

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 1) {
    fps = fpsFrames / fpsTime;
    const total = sim.drones.reduce((a, d) => a + d.vm.executed, 0);
    opsPerSec = (total - opsAtLastSecond) / fpsTime;
    opsAtLastSecond = total;
    fpsFrames = 0;
    fpsTime = 0;
  }
  stats.textContent =
    `FPS: ${fps.toFixed(0)}   симуляция: ${simMs.toFixed(2)} мс/кадр\n` +
    `Дронов: ${sim.drones.length}   инструкций VM/с: ${Math.round(opsPerSec).toLocaleString("ru")}\n` +
    `Собрано: ${sim.harvested}`;

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
