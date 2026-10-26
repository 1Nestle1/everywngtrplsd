// Дымовой тест игры в настоящем Chrome/Edge: открывает страницу, кликает «Запуск»,
// включает песочницу с программой и сохраняет скриншоты в shots/.
// Запуск: npm run test:browser

import { existsSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

const executablePath = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].find((p): p is string => !!p && existsSync(p));
if (!executablePath) {
  console.error("Не нашёл Chrome/Edge. Укажите путь в переменной CHROME_PATH.");
  process.exit(1);
}

mkdirSync("shots", { recursive: true });
const server = await createServer({ server: { port: 5198 }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls!.local[0];
const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--window-size=1600,900", "--ignore-gpu-blocklist", "--enable-gpu"] });
const errors: string[] = [];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".run-btn");
  await wait(800);
  await page.click(".code-win .run-btn");
  await wait(1500);
  const biomass = await page.evaluate(() => (window as any).__game.world.inventory.Biomass);
  console.log("Биомасса после первого запуска:", biomass);
  await page.screenshot({ path: "shots/1-start.png" });

  // Песочница и программа, засаживающая поле разными растениями
  await page.evaluate(() => {
    const g = (window as any).__game;
    window.confirm = () => true;
    (document.querySelector("#sandbox-btn") as HTMLButtonElement).click();
    const code = [
      "n = get_world_size()",
      "kinds = [Entities.Shard, Entities.Pillar, Entities.Fungus, Entities.Geode, Entities.Solar, Entities.Prism]",
      "for x in range(n):",
      "    for y in range(n):",
      "        k = kinds[x % len(kinds)]",
      "        if k != Entities.Shard and k != Entities.Pillar:",
      "            till()",
      "        plant(k)",
      "        use_item(Items.Water)",
      "        move(North)",
      "    move(East)",
      "print('Поле засажено!')",
    ].join("\n");
    g.setCode("main", code);
    g.world.unlocks.speed = 5;
    g.runner.start("main");
  });
  await wait(9000);
  await page.screenshot({ path: "shots/2-sandbox.png" });
  const state = await page.evaluate(() => {
    const g = (window as any).__game;
    return { size: g.world.size, state: g.runner.state, entities: [...new Set(g.world.cells.map((c: any) => c.entity))] };
  });
  console.log("После песочницы:", JSON.stringify(state));
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll<HTMLButtonElement>(".dock-btn")].find((b) => b.textContent === "Справка")!;
    btn.click();
  });
  await wait(300);
  await page.screenshot({ path: "shots/3-docs.png" });

  // Лабиринт: правило правой руки, код вводится через редактор и запускается кнопкой
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.setCode("main", [
      "clear()",
      "plant(Entities.Shard)",
      "while not can_harvest():",
      "    use_item(Items.Water)",
      "use_item(Items.Nanites, get_world_size())",
      "dirs = [North, East, South, West]",
      "d = 0",
      "while get_entity_type() != Entities.Treasure:",
      "    right = (d + 1) % 4",
      "    if can_move(dirs[right]):",
      "        d = right",
      "        move(dirs[d])",
      "    elif can_move(dirs[d]):",
      "        move(dirs[d])",
      "    else:",
      "        d = (d + 3) % 4",
      "print('Сокровище!', measure())",
    ].join("\n"));
  });
  await page.evaluate(() => (document.querySelector(".code-win .run-btn") as HTMLButtonElement).click());
  await wait(2500);
  await page.screenshot({ path: "shots/4-maze.png" });
  await wait(15000);
  const maze = await page.evaluate(() => {
    const g = (window as any).__game;
    return { state: g.runner.state, onTreasure: g.world.cell().entity, line: g.runner.line };
  });
  console.log("Лабиринт:", JSON.stringify(maze));
} finally {
  await browser.close();
  await server.close();
}
console.log(errors.length ? `Ошибки на странице:\n${errors.join("\n")}` : "Ошибок на странице нет");
process.exit(errors.length ? 1 : 0);
