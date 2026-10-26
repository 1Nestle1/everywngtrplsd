// Мелкие помощники для DOM, общие для интерфейса игры.

export const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
};

export const fmt = (n: number) => Math.floor(n).toLocaleString("ru-RU");
