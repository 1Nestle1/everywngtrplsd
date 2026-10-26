// 3D-сцена: платформа на астероиде, растения, дрон, стены лабиринта.
// Поле маленькое (до 10×10), поэтому у каждой клетки своя группа мешей,
// которую пересобираем только когда меняется её содержимое.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ITEM_INFO, type Dir } from "./api";
import type { Cell, World } from "./world";

const TILE = 1;
const GAP = 0.06;

// Общие материалы
const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, flatShading: true, ...extra });
const M = {
  rock: mat("#4a4560"),
  dust: mat("#7a4a35"),
  moss: mat("#5fe08a", { emissive: "#1f7a43", emissiveIntensity: 0.5 }),
  shard: mat("#8fe8ff", { emissive: "#2aa6d6", emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.2 }),
  pillar: mat("#8d6cff", { emissive: "#3b1fa8", emissiveIntensity: 0.35 }),
  pillarCap: mat("#d9c8ff", { emissive: "#8a6cff", emissiveIntensity: 0.8 }),
  stalk: mat("#e8d9c4"),
  fungus: mat("#ff8a4c", { emissive: "#b03d10", emissiveIntensity: 0.5 }),
  geode: mat("#3a2b52"),
  geodeCore: mat("#c69bff", { emissive: "#8b45ff", emissiveIntensity: 1.1, roughness: 0.2 }),
  dead: mat("#3b3b42"),
  solarStem: mat("#4f8a3a"),
  solarDisc: mat("#3b2a12"),
  petal: mat("#ffd84a", { emissive: "#c48a00", emissiveIntensity: 0.6, side: THREE.DoubleSide }),
  hedge: mat("#2d6b5a", { emissive: "#0e3a2e", emissiveIntensity: 0.4 }),
  gold: mat("#ffc247", { emissive: "#ff9a00", emissiveIntensity: 0.9, metalness: 0.7, roughness: 0.25 }),
  droneBody: mat("#dfe4ee", { metalness: 0.5, roughness: 0.35 }),
  droneDark: mat("#22252f", { metalness: 0.4 }),
  droneEye: new THREE.MeshBasicMaterial({ color: "#ffb547" }),
  rotor: new THREE.MeshBasicMaterial({ color: "#9aa3b5", transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
};
const prismMats = Array.from({ length: 10 }, (_, i) =>
  mat(new THREE.Color().setHSL(0.62 - i * 0.07, 0.8, 0.6).getStyle(), {
    emissive: new THREE.Color().setHSL(0.62 - i * 0.07, 0.9, 0.3).getStyle(),
    emissiveIntensity: 0.7, roughness: 0.2, transparent: true, opacity: 0.92,
  }),
);

const G = {
  tile: new THREE.BoxGeometry(TILE - GAP, 0.24, TILE - GAP),
  blob: new THREE.IcosahedronGeometry(0.12, 0),
  shard: new THREE.OctahedronGeometry(0.16, 0),
  pillar: new THREE.CylinderGeometry(0.17, 0.22, 1, 6),
  pillarCap: new THREE.OctahedronGeometry(0.2, 0),
  stalk: new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6),
  cap: new THREE.SphereGeometry(0.22, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
  geode: new THREE.DodecahedronGeometry(0.32, 0),
  core: new THREE.OctahedronGeometry(0.17, 0),
  stem: new THREE.CylinderGeometry(0.03, 0.04, 0.5, 5),
  disc: new THREE.CylinderGeometry(0.1, 0.1, 0.04, 10),
  petal: new THREE.PlaneGeometry(0.08, 0.2),
  prism: new THREE.CylinderGeometry(0.2, 0.2, 1, 3),
  hedge: new THREE.BoxGeometry(1, 0.7, 0.12),
  treasure: new THREE.IcosahedronGeometry(0.24, 0),
};

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

/** Строит модель растения в группе. Масштаб по росту задаётся снаружи. */
function buildEntity(c: Cell, seed: number): THREE.Object3D {
  const g = new THREE.Group();
  const rnd = mulberry(seed);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  switch (c.entity) {
    case "Moss":
      for (let i = 0; i < 5; i++) {
        const b = add(G.blob, M.moss, (rnd() - 0.5) * 0.6, 0.04, (rnd() - 0.5) * 0.6);
        b.scale.set(1 + rnd(), 0.45, 1 + rnd());
      }
      break;
    case "Shard":
      for (let i = 0; i < 3; i++) {
        const s = add(G.shard, M.shard, (rnd() - 0.5) * 0.3, 0.2, (rnd() - 0.5) * 0.3);
        s.scale.set(0.8, 1.6 + rnd() * 1.4, 0.8);
        s.rotation.set((rnd() - 0.5) * 0.6, rnd() * 3, (rnd() - 0.5) * 0.6);
      }
      break;
    case "Pillar": {
      const p = add(G.pillar, M.pillar, 0, 0.6, 0);
      p.scale.y = 1.2;
      add(G.pillarCap, M.pillarCap, 0, 1.3, 0);
      break;
    }
    case "Fungus":
      for (let i = 0; i < 3; i++) {
        const x = (rnd() - 0.5) * 0.4, z = (rnd() - 0.5) * 0.4, s = 0.6 + rnd() * 0.6;
        add(G.stalk, M.stalk, x, 0.15 * s, z).scale.setScalar(s);
        add(G.cap, M.fungus, x, 0.28 * s, z).scale.setScalar(s);
      }
      break;
    case "Geode":
      add(G.geode, M.geode, 0, 0.25, 0).rotation.y = rnd() * 3;
      add(G.core, M.geodeCore, 0, 0.45, 0);
      break;
    case "Dead_Geode": {
      const d = add(G.geode, M.dead, 0, 0.18, 0);
      d.scale.set(1, 0.6, 1);
      d.rotation.z = 0.4;
      break;
    }
    case "Solar": {
      add(G.stem, M.solarStem, 0, 0.25, 0);
      const head = new THREE.Group();
      head.position.y = 0.52;
      head.rotation.x = -0.5;
      head.add(new THREE.Mesh(G.disc, M.solarDisc));
      for (let i = 0; i < c.value; i++) {
        const a = (i / c.value) * Math.PI * 2;
        const p = new THREE.Mesh(G.petal, M.petal);
        p.position.set(Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17);
        p.rotation.set(-Math.PI / 2, 0, -a + Math.PI / 2);
        head.add(p);
      }
      g.add(head);
      break;
    }
    case "Prism": {
      const h = 0.25 + c.value * 0.09;
      const p = add(G.prism, prismMats[c.value], 0, h / 2, 0);
      p.scale.y = h;
      break;
    }
    case "Treasure":
      add(G.treasure, M.gold, 0, 0.4, 0).name = "spin";
      break;
  }
  return shadowed(g);
}

function mulberry(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface CellView {
  tile: THREE.Mesh;
  key: string;
  obj: THREE.Object3D | null;
  seed: number;
}

interface Popup {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  age: number;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
  readonly controls: OrbitControls;
  private board = new THREE.Group();
  private views: CellView[] = [];
  private builtSize = -1;
  private builtVersion = -1;
  private giant = new THREE.Group();
  private walls = new THREE.Group();
  private drone = new THREE.Group();
  private rotors: THREE.Object3D[] = [];
  private droneVis = new THREE.Vector3();
  private flipT = 0;
  private bubble: HTMLDivElement;
  private bubbleT = 0;
  private popups: Popup[] = [];
  private sun: THREE.DirectionalLight;
  private platform: THREE.Mesh;

  constructor(private canvas: HTMLCanvasElement, private overlay: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const s = this.scene;
    s.background = new THREE.Color("#06070c");
    s.fog = new THREE.Fog("#06070c", 30, 80);
    s.add(new THREE.HemisphereLight("#9fb4ff", "#3a2a2a", 0.9));
    this.sun = new THREE.DirectionalLight("#ffe2b8", 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    s.add(this.sun, this.sun.target);
    const rim = new THREE.DirectionalLight("#5ce1e6", 0.6);
    rim.position.set(-10, 6, -12);
    s.add(rim);

    s.add(this.makeStars());
    // Астероид под платформой
    const rockGeo = new THREE.IcosahedronGeometry(1, 2);
    const pos = rockGeo.attributes.position;
    const r = mulberry(7);
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      v.multiplyScalar(0.85 + r() * 0.3);
      // плоская верхушка — на ней лежит поле
      pos.setXYZ(i, v.x, Math.min(v.y, 0), v.z);
    }
    rockGeo.computeVertexNormals();
    this.platform = new THREE.Mesh(rockGeo, mat("#2b2738", { roughness: 1 }));
    this.platform.receiveShadow = true;
    s.add(this.platform);

    s.add(this.board, this.giant, this.walls);
    this.buildDrone();
    s.add(this.drone);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.45;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 40;

    this.bubble = document.createElement("div");
    this.bubble.className = "bubble";
    overlay.appendChild(this.bubble);

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  private makeStars(): THREE.Points {
    const n = 1500;
    const arr = new Float32Array(n * 3);
    const r = mulberry(3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(150 + r() * 100);
      arr.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ color: "#c9d4ff", size: 0.9, sizeAttenuation: true, fog: false }));
  }

  private buildDrone(): void {
    const d = this.drone;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), M.droneBody);
    body.scale.set(1, 0.6, 1);
    d.add(body);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 16), M.droneDark);
    ring.rotation.x = Math.PI / 2;
    d.add(ring);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), M.droneEye);
    eye.position.set(0, 0.0, 0.18);
    d.add(eye);
    const light = new THREE.PointLight("#ffb547", 1.2, 2.5);
    light.position.set(0, -0.15, 0);
    d.add(light);
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.04), M.droneDark);
      arm.position.set(x * 0.15, 0.05, z * 0.15);
      arm.rotation.y = Math.atan2(z, x) * -1;
      d.add(arm);
      const rotor = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), M.rotor);
      rotor.rotation.x = -Math.PI / 2;
      rotor.position.set(x * 0.27, 0.08, z * 0.27);
      d.add(rotor);
      this.rotors.push(rotor);
    }
    shadowed(d);
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Центр клетки в мировых координатах (y клетки → -z, чтобы север был «вверху» экрана). */
  cellPos(x: number, y: number, n: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set((x - (n - 1) / 2) * TILE, 0, -(y - (n - 1) / 2) * TILE);
  }

  private rebuildBoard(w: World): void {
    const n = w.size;
    for (const v of this.views) {
      this.board.remove(v.tile);
      if (v.obj) this.board.remove(v.obj);
    }
    this.views = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const tile = new THREE.Mesh(G.tile, M.rock.clone());
        this.cellPos(x, y, n, tile.position);
        tile.position.y = -0.12;
        tile.receiveShadow = true;
        this.board.add(tile);
        this.views.push({ tile, key: "", obj: null, seed: (x * 73856093) ^ (y * 19349663) });
      }
    // Камера и свет под размер поля
    const span = Math.max(n, 3);
    this.camera.position.set(span * 0.55, span * 1.05 + 2, span * 1.15 + 2);
    this.controls.target.set(0, 0, 0);
    this.sun.position.set(span * 0.8, span * 2 + 4, span * 0.6);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -span;
    sc.right = sc.top = span;
    sc.updateProjectionMatrix();
    this.platform.scale.set(span * 0.85 + 0.6, span * 0.5, span * 0.85 + 0.6);
    this.platform.position.y = -0.26;
    this.builtSize = n;
    this.droneVis.copy(this.cellPos(w.drone.x, w.drone.y, n));
  }

  private syncCells(w: World): void {
    const n = w.size;
    const groups = w.geodeGroups();
    this.giant.clear();
    const shownGiant = new Set<object>();
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      const c = w.cells[i];
      const tm = v.tile.material as THREE.MeshStandardMaterial;
      tm.color.copy((c.ground === "Rock" ? M.rock : M.dust).color).lerp(new THREE.Color("#2f5f9a"), c.water * 0.6);
      const g = c.entity === "Geode" ? groups.get(i) : undefined;
      const hidden = c.entity === "Hedge" || (g && g.k > 1);
      const key = hidden ? "none" : `${c.entity}:${c.value}`;
      if (key !== v.key) {
        if (v.obj) this.board.remove(v.obj);
        v.obj = null;
        if (c.entity && !hidden) {
          v.obj = buildEntity(c, v.seed);
          this.cellPos(i % n, Math.floor(i / n), n, v.obj.position);
          this.board.add(v.obj);
        }
        v.key = key;
      }
      if (g && g.k > 1 && !shownGiant.has(g)) {
        shownGiant.add(g);
        const big = buildEntity({ ...c, entity: "Geode" }, v.seed);
        const p = this.cellPos(g.x + (g.k - 1) / 2, g.y + (g.k - 1) / 2, n);
        big.position.copy(p);
        big.scale.setScalar(g.k * 0.95);
        this.giant.add(big);
      }
    }
    // Стены лабиринта
    this.walls.clear();
    if (w.maze) {
      const p = new THREE.Vector3();
      for (const key of w.maze.walls) {
        const [xs, ys, d] = key.split(",");
        const x = +xs, y = +ys;
        // каждую стену рисуем один раз: только северные и восточные + края
        if (d === "South" && y > 0) continue;
        if (d === "West" && x > 0) continue;
        const m = new THREE.Mesh(G.hedge, M.hedge);
        this.cellPos(x, y, n, p);
        const off = TILE / 2;
        if (d === "North") m.position.set(p.x, 0.35, p.z - off);
        if (d === "South") m.position.set(p.x, 0.35, p.z + off);
        if (d === "East") m.position.set(p.x + off, 0.35, p.z);
        if (d === "West") m.position.set(p.x - off, 0.35, p.z);
        if (d === "East" || d === "West") m.rotation.y = Math.PI / 2;
        m.castShadow = m.receiveShadow = true;
        this.walls.add(m);
      }
    }
  }

  flip(): void {
    this.flipT = 1;
  }

  say(text: string): void {
    this.bubble.textContent = text.length > 60 ? text.slice(0, 57) + "…" : text;
    this.bubbleT = 3;
  }

  popup(x: number, y: number, n: number, item: keyof typeof ITEM_INFO, amount: number): void {
    const el = document.createElement("div");
    el.className = "popup";
    el.textContent = `+${amount} ${ITEM_INFO[item].ru}`;
    el.style.color = ITEM_INFO[item].color;
    this.overlay.appendChild(el);
    const pos = this.cellPos(x, y, n);
    pos.y = 0.6;
    this.popups.push({ el, pos, age: 0 });
    if (this.popups.length > 12) this.popups.shift()!.el.remove();
  }

  render(w: World, dt: number, actionSeconds: number): void {
    if (w.size !== this.builtSize) this.rebuildBoard(w);
    if (w.version !== this.builtVersion) {
      this.syncCells(w);
      this.builtVersion = w.version;
    }
    const n = w.size;
    const t = performance.now() / 1000;
    // Рост растений и покачивание
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      if (!v.obj) continue;
      const c = w.cells[i];
      const s = c.entity === "Hedge" || c.entity === "Treasure" ? 1 : 0.2 + 0.8 * c.progress;
      v.obj.scale.setScalar(s);
      if (c.progress >= 1 && c.entity !== "Dead_Geode") v.obj.rotation.y = Math.sin(t * 1.5 + v.seed) * 0.05;
      const spin = v.obj.getObjectByName("spin");
      if (spin) spin.rotation.y = t * 2;
    }
    // Дрон: плавно летит к клетке; через край поля — мгновенно
    const target = this.cellPos(w.drone.x, w.drone.y, n);
    const dist = target.distanceTo(this.droneVis);
    if (dist > 1.5) this.droneVis.copy(target);
    else {
      const speed = TILE / Math.max(actionSeconds, 0.02);
      const stepLen = Math.min(dist, speed * dt * 1.15);
      if (dist > 1e-4) {
        const dir = target.clone().sub(this.droneVis).normalize();
        this.drone.rotation.y = lerpAngle(this.drone.rotation.y, Math.atan2(dir.x, dir.z), Math.min(1, dt * 12));
        this.droneVis.addScaledVector(dir, stepLen);
      }
    }
    this.drone.position.set(this.droneVis.x, 0.75 + Math.sin(t * 3) * 0.05, this.droneVis.z);
    for (const r of this.rotors) r.rotation.z += dt * 40;
    if (this.flipT > 0) {
      this.flipT = Math.max(0, this.flipT - dt * 1.5);
      this.drone.rotation.x = (1 - this.flipT) * Math.PI * 2;
      this.drone.position.y += Math.sin((1 - this.flipT) * Math.PI) * 0.6;
    } else this.drone.rotation.x = 0;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    // HTML-оверлеи поверх сцены
    const proj = new THREE.Vector3();
    if (this.bubbleT > 0) {
      this.bubbleT -= dt;
      proj.copy(this.drone.position).setY(this.drone.position.y + 0.45).project(this.camera);
      this.place(this.bubble, proj);
      this.bubble.style.opacity = String(Math.min(1, this.bubbleT * 2));
    } else this.bubble.style.opacity = "0";
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.age += dt;
      if (p.age > 1.4) {
        p.el.remove();
        this.popups.splice(i, 1);
        continue;
      }
      proj.copy(p.pos).setY(p.pos.y + p.age * 0.8).project(this.camera);
      this.place(p.el, proj);
      p.el.style.opacity = String(Math.min(1, (1.4 - p.age) * 2));
    }
  }

  private place(el: HTMLElement, ndc: THREE.Vector3): void {
    const x = (ndc.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-ndc.y * 0.5 + 0.5) * window.innerHeight;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export type { Dir };
