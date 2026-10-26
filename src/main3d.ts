import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Sim } from "./sim";

// 3D-версия демо: та же симуляция, что в 2D, но поле, ресурсы и дроны — 3D.
// Главные оптимизации:
//  - InstancedMesh: всё поле, все ресурсы и все дроны — по одному draw call на тип;
//  - рост ресурса считается в шейдере: в GPU каждый кадр уходит сам массив sim.growth
//    (одно число на клетку), а не матрицы;
//  - у дронов обновляется только сдвиг в готовом буфере матриц, без аллокаций.

const MAX_DRONES = 20_000;

// --- Рендерер, сцена, камера ---
const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#0e1116");
scene.fog = new THREE.Fog("#0e1116", 60, 400);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight("#bcd6ff", "#2a2f22", 1.2));
const sun = new THREE.DirectionalLight("#fff4e0", 2.2);
scene.add(sun, sun.target);

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// --- Материал ресурса: масштаб и цвет зависят от роста, считаются на GPU ---
const GROWTH_VERTEX = (shader: { vertexShader: string }) => {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float aGrowth;\nvarying float vGrowth;")
    .replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvGrowth = aGrowth;\ntransformed *= max(aGrowth, 0.08);",
    );
};

function makeCrystalMaterials(): { color: THREE.Material; depth: THREE.Material } {
  const color = new THREE.MeshLambertMaterial();
  color.onBeforeCompile = (shader) => {
    GROWTH_VERTEX(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGrowth;")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\n" +
          "diffuseColor.rgb = vGrowth >= 0.999 ? vec3(0.95, 0.72, 0.22)" +
          " : mix(vec3(0.12, 0.3, 0.18), vec3(0.3, 0.85, 0.5), vGrowth);",
      );
  };
  // Тени тоже должны «расти», иначе от маленького кристалла будет тень полного.
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = GROWTH_VERTEX;
  return { color, depth };
}

// --- Мир: симуляция + инстансы ---
interface World {
  sim: Sim;
  crystalGrowth: THREE.InstancedBufferAttribute;
  drones: THREE.InstancedMesh;
  dispose(): void;
}

let world: World | null = null;

function buildWorld(size: number, droneCount: number, shadows: boolean): World {
  world?.dispose();

  const sim = new Sim(size, size);
  sim.spawn(Math.min(droneCount, MAX_DRONES));
  const cells = size * size;
  const half = size / 2;
  const objects: THREE.Object3D[] = [];
  const disposables: { dispose(): void }[] = [];

  // Плитки поля: статичные, матрицы задаются один раз.
  const tileGeo = new THREE.BoxGeometry(0.94, 0.25, 0.94);
  const tileMat = new THREE.MeshLambertMaterial({ color: "#2a332c" });
  const tiles = new THREE.InstancedMesh(tileGeo, tileMat, cells);
  const m = new THREE.Matrix4();
  for (let i = 0; i < cells; i++) {
    m.makeTranslation((i % size) - half + 0.5, 0, Math.floor(i / size) - half + 0.5);
    tiles.setMatrixAt(i, m);
  }
  tiles.receiveShadow = shadows;
  objects.push(tiles);
  disposables.push(tileGeo, tileMat, tiles);

  // Ресурсы: тоже статичные матрицы, меняется только атрибут aGrowth.
  const crystalGeo = new THREE.OctahedronGeometry(0.28, 0);
  crystalGeo.scale(1, 1.7, 1);
  crystalGeo.translate(0, 0.28 * 1.7, 0);
  const crystalGrowth = new THREE.InstancedBufferAttribute(sim.growth, 1);
  crystalGrowth.setUsage(THREE.DynamicDrawUsage);
  crystalGeo.setAttribute("aGrowth", crystalGrowth);
  const crystalMats = makeCrystalMaterials();
  const crystals = new THREE.InstancedMesh(crystalGeo, crystalMats.color, cells);
  crystals.customDepthMaterial = crystalMats.depth;
  for (let i = 0; i < cells; i++) {
    m.makeTranslation((i % size) - half + 0.5, 0.125, Math.floor(i / size) - half + 0.5);
    crystals.setMatrixAt(i, m);
  }
  crystals.castShadow = shadows;
  crystals.receiveShadow = shadows;
  objects.push(crystals);
  disposables.push(crystalGeo, crystalMats.color, crystalMats.depth, crystals);

  // Дроны: буфер матриц на максимум, в кадре пишем только сдвиг.
  const droneGeo = new THREE.BoxGeometry(0.55, 0.16, 0.55);
  const droneMat = new THREE.MeshStandardMaterial({ color: "#4ad9ff", emissive: "#0b3a4a", roughness: 0.4 });
  const drones = new THREE.InstancedMesh(droneGeo, droneMat, Math.max(1, sim.drones.length));
  drones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  drones.frustumCulled = false; // позиции меняются каждый кадр, bounding sphere неактуальна
  drones.castShadow = shadows;
  objects.push(drones);
  disposables.push(droneGeo, droneMat, drones);

  scene.add(...objects);

  renderer.shadowMap.enabled = shadows;
  sun.castShadow = shadows;
  sun.position.set(half * 0.6, size * 0.9, half * 0.8);
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -half - 2;
  sc.right = sc.top = half + 2;
  sc.near = 1;
  sc.far = size * 3;
  sc.updateProjectionMatrix();
  sun.shadow.map?.dispose();
  sun.shadow.map = null;

  camera.position.set(0, size * 0.75, size * 0.85);
  controls.target.set(0, 0, 0);
  controls.update();

  return {
    sim,
    crystalGrowth,
    drones,
    dispose() {
      scene.remove(...objects);
      for (const d of disposables) d.dispose();
    },
  };
}

function updateDrones(w: World, speed: number, time: number): void {
  const { sim, drones } = w;
  const arr = drones.instanceMatrix.array as Float32Array;
  const half = sim.width / 2;
  const list = sim.drones;
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    const t = sim.progress(d, speed);
    // При переходе через край поля не тянем дрона через всё поле, а ставим сразу.
    const x = Math.abs(d.x - d.fromX) > 1 ? d.x : d.fromX + (d.x - d.fromX) * t;
    const y = Math.abs(d.y - d.fromY) > 1 ? d.y : d.fromY + (d.y - d.fromY) * t;
    const o = i * 16;
    arr[o] = arr[o + 5] = arr[o + 10] = arr[o + 15] = 1;
    arr[o + 12] = x - half + 0.5;
    arr[o + 13] = 1.1 + Math.sin(time * 3 + i) * 0.06;
    arr[o + 14] = y - half + 0.5;
  }
  drones.count = list.length;
  drones.instanceMatrix.needsUpdate = true;
}

// --- UI ---
const sizeInput = document.querySelector<HTMLSelectElement>("#size")!;
const dronesInput = document.querySelector<HTMLInputElement>("#drones")!;
const speedInput = document.querySelector<HTMLInputElement>("#speed")!;
const shadowsInput = document.querySelector<HTMLInputElement>("#shadows")!;
const stats = document.querySelector<HTMLPreElement>("#stats")!;

const rebuild = () =>
  (world = buildWorld(Number(sizeInput.value), Number(dronesInput.value), shadowsInput.checked));
for (const el of [sizeInput, dronesInput, shadowsInput]) el.addEventListener("change", rebuild);

function gpuName(): string {
  const gl = renderer.getContext();
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}
const GPU = gpuName();

// --- Кадр ---
let last = performance.now();
let simMs = 0;
let renderMs = 0;
let fps = 0;
let fpsFrames = 0;
let fpsTime = 0;
let onFrame: ((dtMs: number) => void) | null = null;

function frame(t: number): void {
  const dtMs = t - last;
  const dt = Math.min(dtMs / 1000, 0.1);
  last = t;
  const w = world!;
  const speed = Number(speedInput.value);

  const s0 = performance.now();
  w.sim.step(dt, speed);
  simMs = performance.now() - s0;

  const r0 = performance.now();
  w.crystalGrowth.needsUpdate = true;
  updateDrones(w, speed, t / 1000);
  controls.update();
  renderer.render(scene, camera);
  renderMs = performance.now() - r0;

  onFrame?.(dtMs);

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = fpsFrames / fpsTime;
    fpsFrames = 0;
    fpsTime = 0;
  }
  const info = renderer.info.render;
  stats.textContent =
    `FPS: ${fps.toFixed(0)}\n` +
    `симуляция: ${simMs.toFixed(2)} мс   рендер (CPU): ${renderMs.toFixed(2)} мс\n` +
    `draw calls: ${info.calls}   треугольников: ${info.triangles.toLocaleString("ru")}\n` +
    `клеток: ${w.sim.growth.length.toLocaleString("ru")}   дронов: ${w.sim.drones.length}\n` +
    `собрано: ${w.sim.harvested}\nGPU: ${GPU}`;

  requestAnimationFrame(frame);
}

// --- Автобенчмарк (?bench=1): прогоняет сценарии и складывает итог в window.__bench ---
interface Scenario { size: number; drones: number; speed: number; shadows: boolean }
interface ScenarioResult extends Scenario {
  fps: number;
  p95FrameMs: number;
  simMs: number;
  renderCpuMs: number;
  drawCalls: number;
  triangles: number;
}

const SCENARIOS: Scenario[] = [
  { size: 32, drones: 100, speed: 10, shadows: false },
  { size: 64, drones: 1000, speed: 10, shadows: true },
  { size: 128, drones: 5000, speed: 10, shadows: true },
  { size: 256, drones: 20000, speed: 10, shadows: true },
  { size: 256, drones: 20000, speed: 10, shadows: false },
];

function measureScenario(s: Scenario): Promise<ScenarioResult> {
  sizeInput.value = String(s.size);
  dronesInput.value = String(s.drones);
  speedInput.value = String(s.speed);
  shadowsInput.checked = s.shadows;
  rebuild();
  return new Promise((done) => {
    const frames: number[] = [];
    let sumSim = 0;
    let sumRender = 0;
    let warm = 0;
    onFrame = (dtMs) => {
      warm += dtMs;
      if (warm < 1000) return; // прогрев: компиляция шейдеров, JIT
      frames.push(dtMs);
      sumSim += simMs;
      sumRender += renderMs;
      if (frames.length < 2 || frames.reduce((a, b) => a + b, 0) < 3000) return;
      onFrame = null;
      const sorted = [...frames].sort((a, b) => a - b);
      const total = frames.reduce((a, b) => a + b, 0);
      done({
        ...s,
        fps: (frames.length * 1000) / total,
        p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
        simMs: sumSim / frames.length,
        renderCpuMs: sumRender / frames.length,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      });
    };
  });
}

async function runBench(): Promise<void> {
  const results: ScenarioResult[] = [];
  for (const s of SCENARIOS) results.push(await measureScenario(s));
  const w = window as unknown as { __bench: unknown };
  w.__bench = { gpu: GPU, width: canvas.width, height: canvas.height, results };
  console.log(JSON.stringify(w.__bench));
}

rebuild();
requestAnimationFrame(frame);
if (new URLSearchParams(location.search).has("bench")) void runBench();
