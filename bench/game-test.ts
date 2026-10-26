// Безоконная проверка игры: язык, разблокировки и механики мира.
// Запуск: npm run test:game

import { UNLOCKS } from "../src/game/api";
import { currentGuide } from "../src/game/guide";
import { parse } from "../src/game/lang/parser";
import { Runner } from "../src/game/runner";
import { World } from "../src/game/world";

let failed = 0;
function check(name: string, ok: boolean, extra = ""): void {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed++;
}

function setup(files: Record<string, string>, unlockAll = true) {
  const w = new World();
  if (unlockAll) for (const u of UNLOCKS) if (u.id !== "beacon") for (let i = 0; i < u.costs.length; i++) w.applyUnlock(u.id);
  const out: string[] = [];
  const errs: string[] = [];
  const r = new Runner(w, {
    getSource: (f) => files[f] ?? null,
    onOutput: (t, k) => (k === "err" ? errs : out).push(t),
    onStateChange: () => {},
  });
  const sim = (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) {
      w.update(0.05);
      r.update(0.05);
      if (r.state === "idle") break;
    }
  };
  return { w, r, out, errs, sim };
}

// 1. Язык
{
  const { r, out, errs, sim } = setup({
    main: `
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)
xs = []
for i in range(8):
    xs.append(fib(i))
print(xs)
d = {"a": 1, (1, 2): "t"}
d["b"] = d["a"] * 10
print(d["b"], d[(1, 2)], len(d), "a" in d)
a, b = 3, 4
a += b ** 2
print(a, 7 // 2, -7 % 3, 7 / 2, "x" * 3)
total = 0
while True:
    total += 1
    if total >= 5:
        break
print(total, max(xs), min(3, 1, 2), sorted([3, 1, 2]), "yes" if total == 5 else "no")
from helper import *
print(double(21))
import helper
print(helper.double(2))
`,
    helper: "def double(x):\n    return x * 2\n",
  });
  r.start("main");
  sim(60);
  check("язык: функции, списки, словари, циклы, import", errs.length === 0 && out.join("|").startsWith(
    "[0, 1, 1, 2, 3, 5, 8, 13]|10 t 3 True|19 3 2 3.5 xxx|5 13 1 [1, 2, 3] yes|42|4"), errs.join() || out.join(" | "));
}

// 2. Ошибки разбора
{
  let line = 0;
  try { parse("if True:\nharvest()"); } catch (e) { line = (e as { line: number }).line; }
  check("парсер сообщает строку ошибки", line === 2);
}

// 3. Блокировки в начале игры
{
  const { r, errs, sim } = setup({ main: "while True:\n    harvest()" }, false);
  r.start("main");
  sim(1);
  check("while заблокирован без «Циклов»", errs.length === 1 && errs[0].includes("Циклы"), errs[0]);
}
{
  const { w, r, errs, sim } = setup({ main: "harvest()" }, false);
  sim(0);
  w.update(1);
  r.start("main");
  sim(2);
  check("первый harvest() даёт биомассу", errs.length === 0 && w.inventory.Biomass === 1, `${w.inventory.Biomass}`);
}

// 4. Сбор урожая по всему полю
{
  const { w, r, errs, sim } = setup({
    main: `
n = get_world_size()
for i in range(3):
    for x in range(n):
        for y in range(n):
            if can_harvest():
                harvest()
            if get_entity_type() == None:
                plant(Entities.Shard)
            move(North)
        move(East)
`,
  });
  r.start("main");
  sim(600);
  check("обход поля и посадка", errs.length === 0 && w.inventory.Biomass > 0, errs.join() + ` biomass=${w.inventory.Biomass} silicon=${w.inventory.Silicon}`);
}

// 5. Жеоды сливаются
{
  const { w } = setup({});
  w.inventory.Spores = 100;
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++) {
      w.drone.x = x; w.drone.y = y;
      w.till();
      w.plant("Geode");
    }
  for (const c of w.cells.slice(0, 0)) void c;
  for (let i = 0; i < 9; i++) {
    const c = w.cell(i % 3, Math.floor(i / 3));
    c.progress = 1;
    c.entity = "Geode";
  }
  w.drone.x = 1; w.drone.y = 1;
  w.harvest();
  check("квадрат жеод 3×3 даёт 27 самоцветов", w.inventory.Gems === 27, `${w.inventory.Gems}`);
}

// 6. Сортировка призм кодом игрока (пузырёк по строкам и столбцам)
{
  const { w, r, errs, sim } = setup({
    main: `
clear()
n = get_world_size()
for x in range(n):
    for y in range(n):
        till()
        plant(Entities.Prism)
        move(North)
    move(East)
def sort_line(d_fwd, d_back):
    for _ in range(n):
        for i in range(n - 1):
            if measure() > measure(d_fwd):
                swap(d_fwd)
            move(d_fwd)
        for i in range(n - 1):
            move(d_back)
for x in range(n):
    sort_line(North, South)
    move(East)
for y in range(n):
    sort_line(East, West)
    move(North)
while not can_harvest():
    pass
harvest()
`,
  });
  w.inventory.Gems = 1000;
  r.start("main");
  sim(3000);
  const n = w.size;
  check("отсортированные призмы дают n² кристаллов", errs.length === 0 && w.inventory.Crystal === n * n * n * n,
    errs.join() + ` crystal=${w.inventory.Crystal}, ожидалось ${n ** 4}`);
}

// 7. Лабиринт: правило правой руки
{
  const { w, r, errs, sim } = setup({
    main: `
clear()
plant(Entities.Shard)
while not can_harvest():
    pass
use_item(Items.Nanites, get_world_size())
dirs = [North, East, South, West]
d = 0
while get_entity_type() != Entities.Treasure:
    right = (d + 1) % 4
    if can_move(dirs[right]):
        d = right
        move(dirs[d])
    elif can_move(dirs[d]):
        move(dirs[d])
    else:
        d = (d + 3) % 4
harvest()
`,
  });
  w.inventory.Nanites = 100;
  r.start("main");
  sim(3000);
  check("лабиринт пройден, золото получено", errs.length === 0 && w.inventory.Gold > 0, errs.join() + ` gold=${w.inventory.Gold}`);
}

// 8. Покупка исследований
{
  const w = new World();
  w.inventory.Biomass = 100;
  check("покупка «Циклов»", w.buyUnlock("loops") && w.has("loops"));
  check("«Посадка» недоступна до «Расширения»", !w.buyUnlock("plant"));
  w.buyUnlock("expand");
  check("«Расширение» увеличивает поле до 3×3", w.size === 3);
}

// 9. Начало игры честно, без песочницы: от одного harvest() до «Переменных»
{
  const files: Record<string, string> = { main: "harvest()" };
  const { w, r, errs, sim } = setup(files, false);
  const runFor = (code: string, seconds: number) => {
    files.main = code;
    r.start("main");
    sim(seconds);
    r.stop(true);
  };
  for (let i = 0; i < 5; i++) {
    w.update(1);
    runFor("harvest()", 1);
  }
  const steps: string[] = [];
  const buy = (id: string) => (w.buyUnlock(id) ? steps.push(id) : 0);
  buy("loops");
  runFor("while True:\n    harvest()", 15);
  buy("expand");
  runFor("while True:\n    harvest()\n    move(North)\n    harvest()\n    move(East)", 40);
  buy("plant");
  buy("speed");
  runFor("while True:\n    harvest()\n    plant(Entities.Shard)\n    move(North)\n    harvest()\n    move(East)", 60);
  buy("senses");
  runFor(
    "while True:\n    if can_harvest():\n        harvest()\n        if get_pos_x() == 0:\n            plant(Entities.Shard)\n    move(North)\n    if get_pos_y() == 0:\n        move(East)",
    90,
  );
  buy("variables");
  check("ранняя игра проходится: Циклы → Расширение → Посадка → Сенсоры → Переменные",
    errs.length === 0 && ["loops", "expand", "plant", "senses", "variables"].every((u) => steps.includes(u)),
    `${steps.join(", ")} ${errs.join()} | ${JSON.stringify(w.inventory)}`);
}

// 10. Древо навыков: места не пересекаются, связи ведут к существующим навыкам и только вправо
{
  const at = new Set(UNLOCKS.map((u) => u.at.join(",")));
  const byId = new Map(UNLOCKS.map((u) => [u.id, u]));
  const badLinks = UNLOCKS.flatMap((u) => u.requires.filter((r) => !byId.has(r) || byId.get(r)!.at[0] >= u.at[0]).map((r) => `${r}→${u.id}`));
  check("древо навыков: у каждого навыка своё место, связи идут слева направо", at.size === UNLOCKS.length && !badLinks.length, badLinks.join());
}

// 11. Урожайность: «Густой мох» добавляет к множителю биомассы
{
  const w = new World();
  w.applyUnlock("moss_yield");
  w.cell().progress = 1;
  w.harvest();
  check("«Густой мох» удваивает биомассу", w.inventory.Biomass === 2, `${w.inventory.Biomass}`);
}

// 12. Подсказки ведут по навыкам до победы, и цель всегда достижима
{
  const w = new World();
  const seen: string[] = [];
  for (let i = 0; i < 20; i++) {
    const g = currentGuide(w);
    if (!g.target) break;
    if (!w.visibleUnlock(g.target)) break;
    seen.push(g.target);
    w.applyUnlock(g.target);
  }
  check("подсказки ведут от «Циклов» до «Маяка»", seen[0] === "loops" && seen.at(-1) === "beacon" && w.won, seen.join(" → "));
}

console.log(failed ?`\nПровалено: ${failed}` : "\nВсе проверки пройдены");
process.exit(failed ? 1 : 0);
