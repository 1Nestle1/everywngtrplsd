// Точка входа игры: окна, редакторы кода, древо навыков, справка, подсказки, сохранение и игровой цикл.

import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "./style.css";

import {
  DIRECTIONS, ENTITIES, ENUM_UNLOCKS, FN_BY_NAME, FUNCTIONS, GROUNDS, ITEM_INFO, ITEMS, LANG_UNLOCKS, PLANTS, UNLOCKS,
  UNLOCK_BY_ID, type Entity, type Item,
} from "./api";
import { $, fmt, h } from "./dom";
import { createEditor, renderCode, type CompletionItem, type HoverInfo } from "./editor";
import { currentGuide, KEYWORDS, LESSONS, TIPS } from "./guide";
import { iconSVG, withIcon } from "./icons";
import { Renderer } from "./render";
import { Runner, type RunState } from "./runner";
import { SkillTree } from "./tree";
import { World } from "./world";

const SAVE_KEY = "colonist-save-v1";

const START_CODE = `# Добро пожаловать, дрон!
# Нажмите «Запуск» (или Ctrl+Enter), чтобы выполнить программу.
# harvest() собирает мох под дроном и даёт биомассу.
# Наведите курсор на слово в коде — появится подсказка.
harvest()
`;

// --- Состояние ---
const world = new World();
let files: Record<string, string> = { main: START_CODE };
let fileOrder: string[] = ["main"];
let sandbox = false;
let layout: Record<string, { x: number; y: number; w?: number; h?: number; open: boolean }> = {};
let tipsSeen = new Set<string>();

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
    tipsSeen = new Set(s.tipsSeen ?? []);
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
  localStorage.setItem(SAVE_KEY, JSON.stringify({ world: world.toJSON(), files, fileOrder, sandbox, layout, tipsSeen: [...tipsSeen] }));
}
load();

const skillName = (ids: string) => ids.split("|").map((x) => `«${UNLOCK_BY_ID.get(x)?.ru ?? x}»`).join(" или ");

// --- Окна ---
interface Win {
  el: HTMLDivElement;
  title: HTMLSpanElement;
  tools: HTMLDivElement;
  body: HTMLDivElement;
}
const windows = new Map<string, Win>();
let zTop = 10;

/** Размер экрана; в скрытой вкладке он бывает нулевым — тогда считаем экран обычным ноутбучным. */
function viewport(): { w: number; h: number } {
  const ok = window.innerWidth >= 400 && window.innerHeight >= 300;
  return ok ? { w: window.innerWidth, h: window.innerHeight } : { w: 1280, h: 720 };
}

function createWindow(id: string, title: string, def: { x: number; y: number; w: number; h: number }, closable = true): Win {
  const saved = layout[id];
  const el = h("div", "win");
  el.dataset.id = id;
  const bar = h("div", "win-bar");
  const titleEl = h("span", "win-title", title);
  const tools = h("div", "win-tools");
  bar.append(titleEl, tools);
  if (closable) {
    const close = withIcon(h("button", "icon-btn win-close"), "close");
    close.title = "Закрыть";
    close.setAttribute("aria-label", "Закрыть окно");
    close.onclick = () => {
      el.hidden = true;
      syncDock();
    };
    bar.append(close);
  }
  const body = h("div", "win-body");
  el.append(bar, body);
  const { w: vw, h: vh } = viewport();
  const x = Math.max(0, Math.min(saved?.x ?? def.x, vw - 120));
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

/** Окна не должны уезжать за край, когда окно браузера уменьшили. */
function clampWindows(): void {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (vw < 400 || vh < 300) return; // свёрнутая или скрытая вкладка — размеры недостоверны
  for (const { el } of windows.values()) {
    if (el.hidden) continue;
    el.style.left = `${Math.max(0, Math.min(parseFloat(el.style.left), vw - 120))}px`;
    el.style.top = `${Math.max(56, Math.min(parseFloat(el.style.top), vh - 60))}px`;
  }
}
window.addEventListener("resize", clampWindows);

function toggleWindow(id: string, show?: boolean): void {
  const w = windows.get(id);
  if (!w) return;
  w.el.hidden = show === undefined ? !w.el.hidden : !show;
  if (!w.el.hidden) w.el.style.zIndex = String(++zTop);
  syncDock();
}

// --- Вывод ---
const outWin = createWindow("output", "Вывод", { x: viewport().w - 400, y: viewport().h - 300, w: 380, h: 220 });
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
    explainError(text);
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
let lastFile = fileOrder[0];

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

const DIR_RU: Record<string, string> = { North: "вверх (север)", East: "вправо (восток)", South: "вниз (юг)", West: "влево (запад)" };
const GROUND_RU: Record<string, string> = {
  Rock: "Голый камень. На нём сам растёт мох, можно сажать осколки и столпы.",
  Dust: "Пыль после till(). На ней растут грибница, жеоды, солнечники и призмы.",
};

/** Что показать при наведении на слово в коде. */
function describe(word: string): HoverInfo | null {
  const f = FN_BY_NAME.get(word);
  if (f) {
    if (!world.has(f.unlock)) return { sig: f.sig, body: f.doc, note: `Пока закрыто — откроется навыком ${skillName(f.unlock)}` };
    return { sig: f.sig, body: f.doc, note: f.ticks >= 100 ? `Действие: ${f.ticks / 1000} с на скорости ×1` : "Мгновенно" };
  }
  if (KEYWORDS[word]) return { sig: word, body: KEYWORDS[word] };
  if (DIR_RU[word]) return { sig: word, body: `Направление: ${DIR_RU[word]}.` };
  const [group, name] = word.split(".");
  if (group === "Entities" && name) {
    const p = PLANTS[name as Entity];
    if (p) {
      const cost = Object.entries(p.cost).map(([k, v]) => `${v} ${ITEM_INFO[k as Item].ru}`).join(", ");
      return { sig: word, body: `${p.ru}. ${p.note}`, note: `${cost ? `Посадка: ${cost}. ` : ""}Созревает за ~${p.grow} с.` };
    }
    const other: Record<string, string> = {
      Dead_Geode: "Треснувшая жеода: урожая не даёт, её нужно собрать и пересадить.",
      Hedge: "Стена лабиринта.",
      Treasure: "Сокровище лабиринта: harvest() на нём даёт золото.",
    };
    if (other[name]) return { sig: word, body: other[name] };
  }
  if (group === "Items" && name && ITEM_INFO[name as Item]) return { sig: word, body: `Ресурс «${ITEM_INFO[name as Item].ru}».` };
  if (group === "Grounds" && GROUND_RU[name]) return { sig: word, body: GROUND_RU[name] };
  if (fileOrder.includes(word)) return { sig: `import ${word}`, body: `Файл кода «${word}». Подключите его, чтобы вызывать его функции.` };
  return null;
}

function openCodeWindow(name: string, index: number): void {
  const win = createWindow(`code:${name}`, name, { x: 16 + index * 28, y: 70 + index * 28, w: 460, h: 380 }, name !== "main");
  win.el.classList.add("code-win");
  win.title.insertAdjacentHTML("beforebegin", iconSVG("file"));
  // Переименование по двойному клику на заголовке
  win.title.title = "Двойной клик — переименовать";
  win.title.ondblclick = () => renameFile(name);
  const runBtn = withIcon(h("button", "run-btn"), "play", "Запуск");
  runBtn.title = "Запуск и остановка: Ctrl+Enter";
  const stepBtn = withIcon(h("button", "text-btn"), "step", "Шаг");
  stepBtn.title = "Выполнить одну строку и остановиться";
  const status = h("span", "run-status");
  win.tools.append(status, stepBtn, runBtn);
  runBtn.onclick = () => toggleRun(name);
  stepBtn.onclick = () => runner.step(name);
  if (name !== "main") win.el.querySelector<HTMLButtonElement>(".win-close")!.title = "Скрыть файл";
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
    describe,
  });
  host.addEventListener("focusin", () => (lastFile = name));
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
  if (lastFile === oldName) lastFile = next;
  const cw = codeWins.get(oldName)!;
  codeWins.delete(oldName);
  windows.delete(`code:${oldName}`);
  cw.win.el.remove();
  openCodeWindow(next, fileOrder.indexOf(next));
  syncDock();
}

/** Вставить пример в редактор, с которым игрок работал последним. */
function insertCode(code: string): void {
  const name = codeWins.has(lastFile) ? lastFile : fileOrder[0];
  const cw = codeWins.get(name);
  if (!cw) return;
  if (runner.file === name && runner.state !== "idle") runner.stop(true);
  cw.setText(code + "\n");
  toggleWindow(`code:${name}`, true);
  skillTree.close();
  toast(`Код вставлен в «${name}». Ctrl+Z в редакторе вернёт прежний.`, "info");
}

function copyCode(code: string): void {
  navigator.clipboard?.writeText(code).then(
    () => toast("Код скопирован", "ok"),
    () => toast("Не удалось скопировать — выделите код вручную", "err"),
  );
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
      const running = active && state === "running";
      withIcon(cw.runBtn, running ? "stop" : "play", running ? "Стоп" : active ? "Дальше" : "Запуск");
      cw.runBtn.classList.toggle("running", running);
      cw.win.el.classList.toggle("active", active);
    }
    document.body.classList.toggle("is-running", state === "running");
  },
});

/** Ошибка в коде: всплывающее сообщение, а для частых случаев — совет. */
function explainError(text: string): void {
  const locked = text.includes("изучите навык") ? UNLOCKS.find((u) => text.includes(`«${u.ru}»`)) : undefined;
  if (locked) toast(text, "err", { label: "Открыть навык", run: () => skillTree.open(locked.id) });
  else toast(text, "err");
  if (/отступ/i.test(text)) showTip("indent");
  else if (text.includes("не определено")) showTip("name");
}

// --- Склад ---
const invEl = $("#inventory");
const invChips = new Map<Item, { chip: HTMLSpanElement; num: HTMLElement }>();
for (const it of ITEMS) {
  const chip = h("span", "chip");
  chip.style.setProperty("--c", ITEM_INFO[it].color);
  chip.title = ITEM_INFO[it].ru;
  const num = h("b");
  chip.append(h("i", "dot"), h("span", "chip-name", ITEM_INFO[it].ru), num);
  invEl.append(chip);
  invChips.set(it, { chip, num });
}
function syncInventory(): void {
  let shown = 0;
  for (const it of ITEMS) {
    const { chip, num } = invChips.get(it)!;
    const v = Math.floor(world.inventory[it]);
    chip.hidden = !(v > 0 || it === "Biomass");
    if (!chip.hidden) shown++;
    const text = fmt(v);
    if (num.textContent !== text) num.textContent = text;
  }
  // Когда ресурсов много, название игры уступает место складу
  $("#topbar").classList.toggle("crowded", shown >= 6);
}

// --- Древо навыков ---
const skillTree = new SkillTree(world, {
  goalTarget: () => currentGuide(world).target,
  copy: copyCode,
  insert: insertCode,
  onToggle: () => syncDock(),
});
document.body.append(skillTree.el);

// --- Справка ---
const DOC_TABS = ["Учебник", "Функции", "Растения"] as const;
let docTab: (typeof DOC_TABS)[number] = "Учебник";
const docWin = createWindow("docs", "Справка", { x: 500, y: 80, w: 500, h: 540 });
const docTabsEl = h("div", "doc-tabs");
docTabsEl.setAttribute("role", "tablist");
const docBody = h("div", "docs");
docWin.body.append(docTabsEl, docBody);
let docKey = "";
function syncDocs(force = false): void {
  const key = docTab + JSON.stringify(world.unlocks);
  if (!force && key === docKey) return;
  docKey = key;
  docTabsEl.innerHTML = "";
  for (const t of DOC_TABS) {
    const b = h("button", "doc-tab", t);
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(t === docTab));
    b.onclick = () => {
      docTab = t;
      syncDocs(true);
      docBody.scrollTop = 0;
    };
    docTabsEl.append(b);
  }
  docBody.innerHTML = "";
  const sec = (title: string) => docBody.appendChild(h("h3", "", title));

  if (docTab === "Учебник") {
    docBody.append(h("p", "doc-lead", "Вы управляете дроном только кодом на языке, похожем на Python. Собирайте ресурсы, изучайте навыки — они открывают новые команды и конструкции языка. Уроки ниже появляются вместе с навыками."));
    for (const l of LESSONS) {
      const open = world.has(l.unlock);
      const art = h("article", open ? "lesson" : "lesson locked");
      art.append(h("h3", "", l.title));
      if (!open) {
        art.append(withIcon(h("p", "doc-lock"), "lock", `Откроется с навыком ${skillName(l.unlock)}`));
        docBody.append(art);
        continue;
      }
      const pre = h("pre", "code-block");
      renderCode(pre, l.code);
      const actions = h("div", "code-actions");
      const copy = withIcon(h("button", "text-btn"), "copy", "Копировать");
      copy.onclick = () => copyCode(l.code);
      const ins = withIcon(h("button", "text-btn"), "insert", "Вставить в редактор");
      ins.onclick = () => insertCode(l.code);
      actions.append(copy, ins);
      art.append(h("p", "", l.text), pre, actions);
      docBody.append(art);
    }
    sec("Клавиши");
    const keys = h("dl", "doc-keys");
    for (const [k, v] of [
      ["Ctrl+Enter", "запустить или остановить программу"],
      ["Tab / Shift+Tab", "сдвинуть строки вправо / влево"],
      ["Ctrl+Space", "подсказать имя функции"],
      ["Ctrl+Z", "отменить правку"],
      ["T", "древо навыков (когда курсор не в редакторе)"],
      ["Esc", "закрыть древо и меню"],
    ]) keys.append(h("dt", "", k), h("dd", "", v));
    docBody.append(keys);
    return;
  }

  if (docTab === "Функции") {
    sec("Язык");
    const lang = h("ul", "doc-list");
    lang.append(h("li", "", "Вызовы функций: harvest()"));
    for (const l of LANG_UNLOCKS) {
      const li = h("li", world.has(l.unlock) ? "" : "locked", l.ru);
      if (!world.has(l.unlock)) li.append(h("span", "doc-lock", ` — ${skillName(l.unlock)}`));
      lang.append(li);
    }
    docBody.append(lang);
    sec("Функции дрона");
    const fl = h("div", "doc-fns");
    for (const f of FUNCTIONS) {
      const row = h("div", world.has(f.unlock) ? "doc-fn" : "doc-fn locked");
      row.append(h("code", "", f.sig));
      row.append(h("span", "", world.has(f.unlock) ? f.doc : `Откроется: ${skillName(f.unlock)}`));
      fl.append(row);
    }
    docBody.append(fl);
    sec("Встроенные функции");
    docBody.append(h("p", "", "range, len, abs, min, max, sum, str, int, float, round, list, tuple, dict, sorted, random. Методы списков: append, pop, insert, remove, index; словарей: keys, values, items, get."));
    return;
  }

  sec("Растения");
  const pl = h("div", "doc-fns");
  for (const [e, p] of Object.entries(PLANTS)) {
    const open = world.has(p!.unlock);
    const row = h("div", open ? "doc-fn" : "doc-fn locked");
    row.append(h("code", "", `Entities.${e}`));
    const cost = Object.entries(p!.cost).map(([k, v]) => `${v} ${ITEM_INFO[k as Item].ru}`).join(", ");
    row.append(h("span", "", open ? `${p!.ru}. ${p!.note}${cost ? ` Посадка: ${cost}.` : ""}` : `Откроется: ${skillName(p!.unlock)}`));
    pl.append(row);
  }
  docBody.append(pl);
  sec("Почва");
  const gl = h("div", "doc-fns");
  for (const g of GROUNDS) {
    const row = h("div", "doc-fn");
    row.append(h("code", "", `Grounds.${g}`), h("span", "", GROUND_RU[g]));
    gl.append(row);
  }
  docBody.append(gl);
}

// --- Док с кнопками окон ---
const dock = $("#dock");
function syncDock(): void {
  dock.innerHTML = "";
  const btn = (label: string, icon: Parameters<typeof iconSVG>[0], on: boolean, onclick: () => void, title = "") => {
    const b = withIcon(h("button", "dock-btn"), icon, label);
    b.classList.toggle("on", on);
    if (title) b.title = title;
    b.onclick = onclick;
    dock.append(b);
    return b;
  };
  for (const f of fileOrder) btn(f, "file", !windows.get(`code:${f}`)?.el.hidden, () => toggleWindow(`code:${f}`)).classList.add("mono");
  btn("Файл", "plus", false, newFile, "Новый файл кода").classList.add("add");
  dock.append(h("span", "dock-sep"));
  const tree = btn("Навыки", "tree", skillTree.isOpen, () => skillTree.toggle(), "Древо навыков (T)");
  tree.classList.add("dock-skills");
  tree.append(skillBadge);
  btn("Справка", "book", !windows.get("docs")?.el.hidden, () => toggleWindow("docs"));
  btn("Вывод", "terminal", !windows.get("output")?.el.hidden, () => toggleWindow("output"));
}
const skillBadge = h("span", "badge");
function syncBadge(): void {
  const n = skillTree.readyCount();
  skillBadge.hidden = n === 0;
  const text = String(n);
  if (skillBadge.textContent !== text) skillBadge.textContent = text;
  skillBadge.title = `Можно изучить: ${n}`;
}

// --- Меню ---
const menu = $("#menu");
withIcon($("#menu-btn"), "menu");
$("#menu-btn").onclick = (e) => {
  e.stopPropagation();
  menu.toggleAttribute("hidden");
};
document.addEventListener("pointerdown", (e) => {
  if (!menu.hidden && !(e.target as HTMLElement).closest("#menu, #menu-btn")) menu.hidden = true;
});
$("#sandbox-btn").onclick = () => {
  if (!confirm("Режим песочницы: изучить все навыки и выдать много ресурсов. Продолжить?")) return;
  sandbox = true;
  for (const u of UNLOCKS) if (u.id !== "beacon") while (world.unlockCost(u.id)) world.applyUnlock(u.id);
  for (const it of ITEMS) world.inventory[it] += 99999;
  runner.rebuildBuiltins();
  skillTree.sync(true);
  menu.hidden = true;
  toast("Песочница включена", "info");
};
$("#reset-btn").onclick = () => {
  if (!confirm("Стереть весь прогресс и код?")) return;
  localStorage.removeItem(SAVE_KEY);
  window.removeEventListener("beforeunload", save);
  location.reload();
};

// --- Цель: следующий навык, прогресс и пример кода ---
const goalEl = $("#goal");
const goalSkill = withIcon(h("button", "goal-skill"), "target");
goalSkill.title = "Открыть в древе навыков";
const goalNeed = h("span", "goal-need");
const goalToggle = withIcon(h("button", "text-btn goal-toggle"), "code", "Пример");
goalToggle.setAttribute("aria-expanded", "false");
const goalBar = h("div", "goal-bar");
const goalFill = goalBar.appendChild(h("i"));
const goalText = h("p", "goal-text");
const goalExample = h("div", "goal-example");
goalExample.hidden = true;
const goalCode = h("pre", "code-block");
const goalActions = h("div", "code-actions");
const goalCopy = withIcon(h("button", "text-btn"), "copy", "Копировать");
const goalInsert = withIcon(h("button", "text-btn"), "insert", "Вставить в редактор");
goalActions.append(goalCopy, goalInsert);
goalExample.append(goalCode, goalActions);
const goalHead = h("div", "goal-head");
goalHead.append(goalSkill, goalNeed, goalToggle);
goalEl.append(goalHead, goalBar, goalText, goalExample);
goalToggle.onclick = () => {
  goalExample.hidden = !goalExample.hidden;
  goalToggle.setAttribute("aria-expanded", String(!goalExample.hidden));
  goalToggle.classList.toggle("on", !goalExample.hidden);
};
goalCopy.onclick = () => copyCode(goalCode.textContent ?? "");
goalInsert.onclick = () => insertCode(goalCode.textContent ?? "");
goalSkill.onclick = () => {
  const t = currentGuide(world).target;
  skillTree.open(t ?? undefined);
};

let goalKey = "";
function syncGoal(): void {
  const g = currentGuide(world);
  const spec = g.target ? UNLOCK_BY_ID.get(g.target)! : null;
  const cost = g.target ? world.unlockCost(g.target) : null;
  if (goalKey !== g.text) {
    goalKey = g.text;
    goalText.textContent = g.text;
    withIcon(goalSkill, spec ? "target" : "check", spec ? spec.ru : "Цель достигнута");
    renderCode(goalCode, g.code ?? "");
    goalToggle.hidden = !g.code;
    if (!g.code) goalExample.hidden = true;
  }
  goalBar.hidden = !cost;
  goalNeed.hidden = !cost;
  if (!cost) {
    goalEl.classList.remove("is-ready");
    return;
  }
  let frac = 1;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(cost)) {
    const have = Math.min(world.inventory[k as Item], v ?? 0);
    frac = Math.min(frac, have / (v ?? 1));
    parts.push(`${ITEM_INFO[k as Item].ru} ${fmt(have)}/${fmt(v ?? 0)}`);
  }
  const ready = frac >= 1;
  const need = ready ? "можно изучить" : parts.join(" · ");
  if (goalNeed.textContent !== need) goalNeed.textContent = need;
  goalEl.classList.toggle("is-ready", ready);
  goalFill.style.width = `${Math.round(frac * 100)}%`;
}

// --- Советы: каждый показывается один раз за игру ---
const coach = $("#coach");
const coachText = h("p", "coach-text");
const coachOk = h("button", "text-btn", "Понятно");
coach.append(h("span", "coach-icon"), coachText, coachOk);
coach.querySelector(".coach-icon")!.innerHTML = iconSVG("bulb");
const tipQueue: string[] = [];
function showTip(id: string): void {
  if (tipsSeen.has(id) || tipQueue.includes(id) || !TIPS[id]) return;
  tipQueue.push(id);
  if (coach.hidden) nextTip();
}
function nextTip(): void {
  const id = tipQueue.shift();
  coach.hidden = !id;
  if (!id) return;
  tipsSeen.add(id);
  coachText.textContent = TIPS[id];
  coach.classList.remove("enter");
  void coach.offsetWidth;
  coach.classList.add("enter");
}
coachOk.onclick = nextTip;

// --- Всплывающие сообщения ---
function toast(text: string, kind: "info" | "err" | "ok", action?: { label: string; run: () => void }): void {
  const el = h("div", `toast toast-${kind}`);
  el.append(h("span", "", text));
  if (action) {
    const b = h("button", "toast-action", action.label);
    b.onclick = () => {
      action.run();
      el.remove();
    };
    el.append(b);
  }
  $("#toasts").append(el);
  const life = action ? 6000 : 3200;
  setTimeout(() => el.classList.add("out"), life);
  setTimeout(() => el.remove(), life + 500);
}

// --- Клавиши ---
document.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (e.key === "Escape") {
    if (skillTree.isOpen) skillTree.close();
    menu.hidden = true;
    return;
  }
  if (t.closest(".cm-editor, input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
  // KeyT — физическая клавиша; «е» — та же клавиша в русской раскладке, если code не пришёл
  if (e.code === "KeyT" || ["t", "T", "е", "Е"].includes(e.key)) {
    e.preventDefault();
    skillTree.toggle();
  }
});

// --- Сборка интерфейса ---
fileOrder.forEach((f, i) => openCodeWindow(f, i));
syncDock();
syncDocs(true);
if (!layout.docs) toggleWindow("docs", false);
clampWindows();
syncGoal();

const renderer = new Renderer($("#scene"), $("#overlay"));

// --- Игровой цикл ---
const speedEl = $("#speed");
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
    else if (e.type === "tip") showTip(e.id);
    else if (e.type === "unlock") {
      runner.rebuildBuiltins();
      if (!sandbox && !skillTree.isOpen) {
        const id = e.id;
        toast(`Изучено: ${UNLOCK_BY_ID.get(id)?.ru}`, "ok", { label: "Подробнее", run: () => skillTree.open(id) });
      }
    } else if (e.type === "maze") toast("Вырос лабиринт! Найдите сокровище", "info");
    else if (e.type === "win") {
      skillTree.close();
      $("#victory").hidden = false;
    }
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
    skillTree.sync();
    syncBadge();
    syncDocs();
    syncGoal();
    const sp = world.speed;
    const speed = `×${sp % 1 ? sp.toFixed(1) : sp}${world.inventory.Power >= 1 ? iconSVG("bolt") : ""}`;
    if (speedEl.innerHTML !== speed) speedEl.innerHTML = speed;
    // Первый запуск: подсвечиваем кнопку, пока игрок ни разу не собрал мох
    const firstRun = !world.has("loops") && world.inventory.Biomass === 0 && runner.state === "idle";
    for (const [name, cw] of codeWins) {
      cw.status.textContent = runner.state !== "idle" && runner.file === name ? `строка ${runner.line}` : "";
      cw.runBtn.classList.toggle("attn", firstRun && name === fileOrder[0]);
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
  __game: { world, runner, files, skillTree, setCode: (name: string, text: string) => codeWins.get(name)?.setText(text) },
});
