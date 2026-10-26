// Точка входа игры: окна, редакторы кода, исследования, справка, сохранение и игровой цикл.

import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "./style.css";

import {
  DIRECTIONS, ENTITIES, ENUM_UNLOCKS, FUNCTIONS, GROUNDS, ITEM_INFO, ITEMS, LANG_UNLOCKS, PLANTS, UNLOCKS, UNLOCK_BY_ID,
  type Item,
} from "./api";
import { createEditor, type CompletionItem } from "./editor";
import { Renderer } from "./render";
import { Runner, type RunState } from "./runner";
import { World } from "./world";

const SAVE_KEY = "colonist-save-v1";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
};

const START_CODE = `# Добро пожаловать, дрон!
# Нажмите ▶ (или Ctrl+Enter), чтобы выполнить программу.
# harvest() собирает мох под дроном и даёт биомассу.
# Циклов пока нет — запускайте программу снова и снова.
harvest()
`;

// --- Состояние ---
const world = new World();
let files: Record<string, string> = { main: START_CODE };
let fileOrder: string[] = ["main"];
let sandbox = false;
let layout: Record<string, { x: number; y: number; w?: number; h?: number; open: boolean }> = {};

function load(): void {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    world.load(s.world);
    files = s.files;
    fileOrder = s.fileOrder;
    sandbox = !!s.sandbox;
    layout = s.layout ?? {};
  } catch (e) {
    console.warn("Сохранение повреждено, начинаем заново", e);
  }
}
function save(): void {
  for (const [id, win] of windows) {
    const r = win.el;
    // у скрытого окна нулевые размеры — для него запоминаем только то, что оно закрыто
    const x = parseFloat(r.style.left), y = parseFloat(r.style.top);
    if (r.hidden) layout[id] = { ...(layout[id] ?? { x, y }), open: false };
    else layout[id] = { x, y, w: r.offsetWidth, h: r.offsetHeight, open: true };
  }
  localStorage.setItem(SAVE_KEY, JSON.stringify({ world: world.toJSON(), files, fileOrder, sandbox, layout }));
}
load();

// --- Окна ---
interface Win {
  el: HTMLDivElement;
  title: HTMLSpanElement;
  tools: HTMLDivElement;
  body: HTMLDivElement;
}
const windows = new Map<string, Win>();
let zTop = 10;

function createWindow(id: string, title: string, def: { x: number; y: number; w: number; h: number }, closable = true): Win {
  const saved = layout[id];
  const el = h("div", "win");
  el.dataset.id = id;
  const bar = h("div", "win-bar");
  const titleEl = h("span", "win-title", title);
  const tools = h("div", "win-tools");
  bar.append(titleEl, tools);
  if (closable) {
    const close = h("button", "icon-btn", "✕");
    close.title = "Закрыть";
    close.onclick = () => {
      el.hidden = true;
      syncDock();
    };
    bar.append(close);
  }
  const body = h("div", "win-body");
  el.append(bar, body);
  const vw = window.innerWidth, vh = window.innerHeight;
  const x = Math.min(saved?.x ?? def.x, vw - 120);
  const y = Math.min(Math.max(saved?.y ?? def.y, 56), vh - 60);
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${saved?.w ?? def.w}px`, height: `${saved?.h ?? def.h}px` });
  el.hidden = saved ? !saved.open : false;
  el.addEventListener("pointerdown", () => (el.style.zIndex = String(++zTop)));
  bar.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop;
    const move = (ev: PointerEvent) => {
      el.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - sx))}px`;
      el.style.top = `${Math.max(52, Math.min(window.innerHeight - 40, ev.clientY - sy))}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  $("#windows").append(el);
  const w = { el, title: titleEl, tools, body };
  windows.set(id, w);
  return w;
}

function toggleWindow(id: string, show?: boolean): void {
  const w = windows.get(id);
  if (!w) return;
  w.el.hidden = show === undefined ? !w.el.hidden : !show;
  if (!w.el.hidden) w.el.style.zIndex = String(++zTop);
  syncDock();
}

// --- Вывод ---
const outWin = createWindow("output", "Вывод", { x: window.innerWidth - 400, y: window.innerHeight - 300, w: 380, h: 220 });
const outList = h("div", "output");
outWin.body.append(outList);
const clearOut = h("button", "text-btn", "Очистить");
clearOut.onclick = () => (outList.innerHTML = "");
outWin.tools.append(clearOut);
function output(text: string, kind: "out" | "err" | "info"): void {
  const line = h("div", `out-${kind}`, text);
  outList.append(line);
  while (outList.childElementCount > 300) outList.firstElementChild!.remove();
  outList.scrollTop = outList.scrollHeight;
  if (kind === "err") {
    toggleWindow("output", true);
    toast(text, "err");
  }
}

// --- Редакторы кода ---
interface CodeWin {
  win: Win;
  setLine: (line: number, kind: "run" | "err" | null) => void;
  setText: (text: string) => void;
  runBtn: HTMLButtonElement;
  stepBtn: HTMLButtonElement;
  status: HTMLSpanElement;
}
const codeWins = new Map<string, CodeWin>();
let errLine: { file: string; line: number } | null = null;

function completions(): CompletionItem[] {
  const out: CompletionItem[] = [];
  for (const f of FUNCTIONS) if (world.has(f.unlock)) out.push({ label: f.name, type: "function", detail: f.sig, info: f.doc });
  for (const d of DIRECTIONS) if (world.has(ENUM_UNLOCKS[d])) out.push({ label: d, type: "constant" });
  const groups: [string, readonly string[]][] = [["Entities", ENTITIES], ["Items", ITEMS], ["Grounds", GROUNDS]];
  for (const [g, names] of groups) {
    out.push({ label: g, type: "namespace" });
    for (const n of names) {
      const u = ENUM_UNLOCKS[`${g}.${n}`];
      if (!u || world.has(u)) out.push({ label: `${g}.${n}`, type: "constant" });
    }
  }
  for (const k of ["range", "len", "abs", "min", "max", "sum", "str", "int", "list", "sorted", "random", "True", "False", "None"])
    out.push({ label: k, type: "keyword" });
  for (const name of fileOrder) out.push({ label: name, type: "variable", detail: "файл" });
  return out;
}

function openCodeWindow(name: string, index: number): void {
  const win = createWindow(`code:${name}`, name, { x: 16 + index * 28, y: 70 + index * 28, w: 460, h: 380 }, name !== "main");
  win.el.classList.add("code-win");
  // Переименование по двойному клику на заголовке
  win.title.title = "Двойной клик — переименовать";
  win.title.ondblclick = () => renameFile(name);
  const runBtn = h("button", "run-btn", "▶ Запуск");
  runBtn.title = "Ctrl+Enter";
  const stepBtn = h("button", "text-btn", "Шаг");
  stepBtn.title = "Выполнить одну строку";
  const status = h("span", "run-status");
  win.tools.append(status, stepBtn, runBtn);
  runBtn.onclick = () => toggleRun(name);
  stepBtn.onclick = () => runner.step(name);
  if (name !== "main") {
    const close = win.el.querySelector<HTMLButtonElement>(".win-bar > .icon-btn")!;
    close.title = "Скрыть файл";
  }
  const host = h("div", "editor-host");
  win.body.append(host);
  const ed = createEditor(host, files[name] ?? "", {
    onChange: (text) => {
      files[name] = text;
      if (errLine?.file === name) {
        errLine = null;
        ed.setLine(0, null);
      }
    },
    onRun: () => toggleRun(name),
    completions,
  });
  const setText = (text: string) => ed.view.dispatch({ changes: { from: 0, to: ed.view.state.doc.length, insert: text } });
  codeWins.set(name, { win, setLine: ed.setLine, setText, runBtn, stepBtn, status });
}

function toggleRun(name: string): void {
  errLine = null;
  if (runner.state === "running" && runner.file === name) runner.stop();
  else if (runner.state === "paused" && runner.file === name) runner.resume();
  else runner.start(name);
}

function newFile(): void {
  let i = 2;
  while (files[`file${i}`] !== undefined) i++;
  const name = `file${i}`;
  files[name] = `# Файл ${name}\n# Его можно подключить из другого файла: import ${name}\n`;
  fileOrder.push(name);
  openCodeWindow(name, fileOrder.length - 1);
  syncDock();
}

function renameFile(oldName: string): void {
  const next = prompt("Новое имя файла (латиница, цифры, _):", oldName)?.trim();
  if (!next || next === oldName) return;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(next) || files[next] !== undefined) {
    toast("Имя должно быть идентификатором и не повторяться", "err");
    return;
  }
  if (runner.file === oldName) runner.stop(true);
  files[next] = files[oldName];
  delete files[oldName];
  fileOrder = fileOrder.map((f) => (f === oldName ? next : f));
  const cw = codeWins.get(oldName)!;
  codeWins.delete(oldName);
  windows.delete(`code:${oldName}`);
  cw.win.el.remove();
  openCodeWindow(next, fileOrder.indexOf(next));
  syncDock();
}

// --- Исполнитель ---
const runner = new Runner(world, {
  getSource: (f) => files[f] ?? null,
  onOutput: (text, kind) => {
    output(text, kind);
    if (kind === "err") errLine = { file: runner.lineFile, line: runner.line };
  },
  onStateChange: (state: RunState, file) => {
    for (const [name, cw] of codeWins) {
      const active = name === file && state !== "idle";
      cw.runBtn.textContent = active && state === "running" ? "■ Стоп" : active ? "▶ Дальше" : "▶ Запуск";
      cw.runBtn.classList.toggle("running", active && state === "running");
      cw.win.el.classList.toggle("active", active);
    }
    document.body.classList.toggle("is-running", state === "running");
  },
});

// --- Склад ---
const invEl = $("#inventory");
const invChips = new Map<Item, HTMLSpanElement>();
for (const it of ITEMS) {
  const chip = h("span", "chip");
  chip.style.setProperty("--c", ITEM_INFO[it].color);
  chip.title = ITEM_INFO[it].ru;
  invEl.append(chip);
  invChips.set(it, chip);
}
function syncInventory(): void {
  for (const it of ITEMS) {
    const chip = invChips.get(it)!;
    const v = Math.floor(world.inventory[it]);
    const seen = v > 0 || (it === "Biomass");
    chip.hidden = !seen;
    const text = `${ITEM_INFO[it].ru} ${v.toLocaleString("ru-RU")}`;
    if (chip.textContent !== text) chip.textContent = text;
  }
}

// --- Исследования ---
const resWin = createWindow("research", "Исследования", { x: window.innerWidth - 400, y: 70, w: 380, h: Math.max(240, window.innerHeight - 400) });
const resList = h("div", "research");
resWin.body.append(resList);
function costHTML(cost: Partial<Record<Item, number>>): HTMLElement {
  const wrap = h("div", "cost");
  for (const [k, v] of Object.entries(cost)) {
    const it = k as Item;
    const c = h("span", "cost-item", `${v} ${ITEM_INFO[it].ru}`);
    c.style.setProperty("--c", ITEM_INFO[it].color);
    if (world.inventory[it] < (v ?? 0)) c.classList.add("short");
    wrap.append(c);
  }
  return wrap;
}
let resKey = "";
function syncResearch(force = false): void {
  // Перерисовываем только когда меняется что-то видимое
  const key = JSON.stringify(world.unlocks) + UNLOCKS.map((u) => {
    const c = world.unlockCost(u.id);
    return c ? (world.canAfford(c) ? 1 : 0) + Object.keys(c).map((k) => (world.inventory[k as Item] >= (c[k as Item] ?? 0) ? 1 : 0)).join("") : "x";
  }).join();
  if (!force && key === resKey) return;
  resKey = key;
  resList.innerHTML = "";
  let hidden = 0;
  for (const u of UNLOCKS) {
    if (!world.visibleUnlock(u.id)) {
      hidden++;
      continue;
    }
    const lvl = world.level(u.id);
    const cost = world.unlockCost(u.id);
    const row = h("div", "res-row");
    const head = h("div", "res-head");
    const name = h("span", "res-name", u.ru);
    if (u.costs.length > 1) name.append(h("span", "res-lvl", ` ${lvl}/${u.costs.length}`));
    head.append(name);
    if (cost) {
      const btn = h("button", "buy-btn", "Открыть");
      btn.disabled = !world.canAfford(cost);
      btn.onclick = () => {
        if (world.buyUnlock(u.id)) syncResearch(true);
      };
      head.append(btn);
    } else head.append(h("span", "res-done", "✓ изучено"));
    row.append(head, h("p", "res-desc", u.desc));
    if (cost) row.append(costHTML(cost));
    else row.classList.add("done");
    resList.append(row);
  }
  if (hidden) resList.append(h("p", "res-hidden", `Ещё ${hidden} исследований откроются позже`));
}

// --- Справка ---
const docWin = createWindow("docs", "Справка", { x: 500, y: 90, w: 480, h: 480 });
const docBody = h("div", "docs");
docWin.body.append(docBody);
let docKey = "";
function syncDocs(): void {
  const key = JSON.stringify(world.unlocks);
  if (key === docKey) return;
  docKey = key;
  docBody.innerHTML = "";
  const sec = (title: string) => docBody.appendChild(h("h3", "", title));
  const ru = (id: string) => id.split("|").map((x) => UNLOCK_BY_ID.get(x)?.ru ?? x).join(" / ");

  sec("Как играть");
  docBody.append(h("p", "", "Вы управляете дроном только кодом на языке, похожем на Python. Собирайте ресурсы, открывайте исследования — они дают новые команды и конструкции языка. Каждое действие дрона занимает время; «Скорость» и энергия его сокращают."));
  sec("Язык");
  const lang = h("ul", "doc-list");
  lang.append(h("li", "", "Вызовы функций: harvest()"));
  for (const l of LANG_UNLOCKS) {
    const li = h("li", world.has(l.unlock) ? "" : "locked", l.ru);
    if (!world.has(l.unlock)) li.append(h("span", "doc-lock", ` — «${ru(l.unlock)}»`));
    lang.append(li);
  }
  docBody.append(lang);
  sec("Функции дрона");
  const fl = h("div", "doc-fns");
  for (const f of FUNCTIONS) {
    const row = h("div", world.has(f.unlock) ? "doc-fn" : "doc-fn locked");
    row.append(h("code", "", f.sig));
    row.append(h("span", "", world.has(f.unlock) ? f.doc : `Откроется: «${ru(f.unlock)}»`));
    fl.append(row);
  }
  docBody.append(fl);
  sec("Растения");
  const pl = h("div", "doc-fns");
  for (const [e, p] of Object.entries(PLANTS)) {
    const open = world.has(p!.unlock);
    const row = h("div", open ? "doc-fn" : "doc-fn locked");
    row.append(h("code", "", `Entities.${e}`));
    const cost = Object.entries(p!.cost).map(([k, v]) => `${v} ${ITEM_INFO[k as Item].ru}`).join(", ");
    row.append(h("span", "", open ? `${p!.ru}. ${p!.note}${cost ? ` Посадка: ${cost}.` : ""}` : `Откроется: «${ru(p!.unlock)}»`));
    pl.append(row);
  }
  docBody.append(pl);
  sec("Встроенные функции");
  docBody.append(h("p", "", "range, len, abs, min, max, sum, str, int, float, round, list, tuple, dict, sorted, random. Методы списков: append, pop, insert, remove, index; словарей: keys, values, items, get."));
}

// --- Док с кнопками окон ---
const dock = $("#dock");
function syncDock(): void {
  dock.innerHTML = "";
  const btn = (label: string, id: string) => {
    const b = h("button", "dock-btn", label);
    b.classList.toggle("on", !windows.get(id)?.el.hidden);
    b.onclick = () => toggleWindow(id);
    dock.append(b);
  };
  for (const f of fileOrder) btn(f, `code:${f}`);
  const add = h("button", "dock-btn add", "+ файл");
  add.title = "Новый файл кода";
  add.onclick = newFile;
  dock.append(add);
  dock.append(h("span", "dock-sep"));
  btn("Исследования", "research");
  btn("Справка", "docs");
  btn("Вывод", "output");
}

// --- Меню ---
$("#menu-btn").onclick = () => $("#menu").toggleAttribute("hidden");
$("#sandbox-btn").onclick = () => {
  if (!confirm("Режим песочницы: открыть все исследования и выдать много ресурсов. Продолжить?")) return;
  sandbox = true;
  for (const u of UNLOCKS) if (u.id !== "beacon") while (world.unlockCost(u.id)) world.applyUnlock(u.id);
  for (const it of ITEMS) world.inventory[it] += 99999;
  runner.rebuildBuiltins();
  syncResearch(true);
  $("#menu").hidden = true;
  toast("Песочница включена", "info");
};
$("#reset-btn").onclick = () => {
  if (!confirm("Стереть весь прогресс и код?")) return;
  localStorage.removeItem(SAVE_KEY);
  window.removeEventListener("beforeunload", save);
  location.reload();
};

// --- Цели ---
function goal(): string {
  const w = world;
  if (w.won) return "Маяк запущен! Колонисты в пути. Можно продолжать оптимизировать код.";
  if (!w.has("loops")) return "Нажмите ▶ — дрон соберёт мох. Накопите 5 биомассы и откройте «Циклы».";
  if (!w.has("expand")) return "Оберните harvest() в «while True:» — дрон будет работать сам. Цель: «Расширение».";
  if (!w.has("plant")) return "Поле стало 3×3. Добавьте move(North) и move(East), чтобы обходить клетки. Цель: «Посадка».";
  if (!w.has("senses")) return "plant(Entities.Shard) сажает осколок (кремний). Он зреет 4 с, срезанный раньше — пропадает. Цель: «Сенсоры».";
  if (!w.has("variables")) return "if can_harvest(): — не срезайте незрелое. Цель: «Переменные».";
  if (!w.has("fungus")) return "for i in range(get_world_size()): — обход поля рядами. Цель: «Грибница».";
  if (!w.has("geodes")) return "till() превращает камень в пыль, на ней растёт грибница. Цель: «Жеоды».";
  if (!w.has("prisms")) return "Сажайте жеоды квадратом: гигантская жеода k×k даёт k³ самоцветов. Цель: «Призмы».";
  if (!w.has("maze")) return "Сортируйте призмы через measure() и swap(): отсортированная группа даёт n². Цель: «Лабиринт».";
  if (!w.has("solar")) return "Солнечники дают энергию — с ней дрон вдвое быстрее. Откройте «Солнечники».";
  return "Вырастите лабиринт (use_item(Items.Nanites, get_world_size()) на осколке), найдите сокровище и запустите «Маяк колонии».";
}

// --- Тосты ---
function toast(text: string, kind: "info" | "err" | "ok"): void {
  const el = h("div", `toast toast-${kind}`, text);
  $("#toasts").append(el);
  setTimeout(() => el.classList.add("out"), 3200);
  setTimeout(() => el.remove(), 3700);
}

// --- Сборка интерфейса ---
fileOrder.forEach((f, i) => openCodeWindow(f, i));
syncDock();
syncResearch(true);
syncDocs();
if (!layout.docs) toggleWindow("docs", false);

const renderer = new Renderer($("#scene"), $("#overlay"));

// --- Игровой цикл ---
let last = performance.now();
let uiTimer = 0;
let saveTimer = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  world.update(dt);
  runner.update(dt);

  for (const e of world.events.splice(0)) {
    if (e.type === "harvest") renderer.popup(e.x, e.y, world.size, e.item, e.amount);
    else if (e.type === "flip") renderer.flip();
    else if (e.type === "print") renderer.say(e.text);
    else if (e.type === "unlock") {
      runner.rebuildBuiltins();
      if (!sandbox) toast(`Изучено: ${UNLOCK_BY_ID.get(e.id)?.ru}`, "ok");
    } else if (e.type === "maze") toast("Вырос лабиринт! Найдите сокровище", "info");
    else if (e.type === "win") $("#victory").hidden = false;
  }

  renderer.render(world, dt, 0.2 / world.speed);

  // Подсветка строк
  for (const [name, cw] of codeWins) {
    if (runner.state !== "idle" && runner.lineFile === name) cw.setLine(runner.line, "run");
    else if (errLine && errLine.file === name) cw.setLine(errLine.line, "err");
    else cw.setLine(0, null);
  }

  uiTimer += dt;
  if (uiTimer > 0.15) {
    uiTimer = 0;
    syncInventory();
    syncResearch();
    syncDocs();
    $("#goal-text").textContent = goal();
    const sp = world.speed;
    $("#speed").textContent = `×${sp % 1 ? sp.toFixed(1) : sp}${world.inventory.Power >= 1 ? " ⚡" : ""}`;
    for (const [name, cw] of codeWins) {
      cw.status.textContent = runner.state !== "idle" && runner.file === name ? `строка ${runner.line}` : "";
    }
  }
  saveTimer += dt;
  if (saveTimer > 5) {
    saveTimer = 0;
    save();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener("beforeunload", save);
$("#victory-close").onclick = () => ($("#victory").hidden = true);

// Для автотестов и отладки из консоли
Object.assign(window, {
  __game: { world, runner, files, setCode: (name: string, text: string) => codeWins.get(name)?.setText(text) },
});
