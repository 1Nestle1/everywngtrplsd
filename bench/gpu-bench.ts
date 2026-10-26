import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

// Запускает 3D-демо в настоящем Chrome/Edge (без окна) и печатает FPS по сценариям.
// Путь к браузеру можно задать через CHROME_PATH.

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter((p): p is string => !!p);

const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error("Не нашёл Chrome/Edge. Укажите путь в переменной CHROME_PATH.");
  process.exit(1);
}

const width = Number(process.env.BENCH_WIDTH ?? 1600);
const height = Number(process.env.BENCH_HEIGHT ?? 900);

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: "error" });
await server.listen();
const url = `${server.resolvedUrls!.local[0]}3d.html?bench=1`;

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    `--window-size=${width},${height}`,
    // Снимаем ограничение в 60 FPS, чтобы видеть реальный запас.
    "--disable-gpu-vsync",
    "--disable-frame-rate-limit",
    "--ignore-gpu-blocklist",
    "--enable-gpu",
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("Ошибка на странице:", e));
  await page.goto(url);
  await page.waitForFunction("window.__bench", { timeout: 180_000, polling: 500 });
  const bench = (await page.evaluate("window.__bench")) as {
    gpu: string;
    width: number;
    height: number;
    results: Record<string, number | boolean>[];
  };

  console.log(`Браузер: ${executablePath}`);
  console.log(`GPU: ${bench.gpu}`);
  console.log(`Холст: ${bench.width}×${bench.height}, vsync выключен\n`);
  console.log("Поле      Дронов  Тени  FPS    p95 кадр  Симуляция  Рендер CPU  Draw calls  Треугольников");
  for (const r of bench.results) {
    console.log(
      `${`${r.size}×${r.size}`.padEnd(9)} ${String(r.drones).padStart(6)}  ${(r.shadows ? "да" : "нет").padEnd(4)}` +
        `  ${(r.fps as number).toFixed(0).padStart(5)}  ${(r.p95FrameMs as number).toFixed(1).padStart(6)} мс` +
        `  ${(r.simMs as number).toFixed(2).padStart(6)} мс  ${(r.renderCpuMs as number).toFixed(2).padStart(7)} мс` +
        `  ${String(r.drawCalls).padStart(10)}  ${(r.triangles as number).toLocaleString("ru").padStart(13)}`,
    );
  }
} finally {
  await browser.close();
  await server.close();
}
