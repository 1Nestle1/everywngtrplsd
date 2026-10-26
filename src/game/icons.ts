// Иконки интерфейса: свои SVG на сетке 24×24, одна толщина линии.
// Заливка — только у «play», «stop» и «step», чтобы кнопки запуска читались сразу.

const STROKE: Record<string, string> = {
  menu: `<path d="M4 7h16M4 12h16M4 17h16"/>`,
  close: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`,
  file: `<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4"/>`,
  plus: `<path d="M12 5.5v13M5.5 12h13"/>`,
  tree: `<circle cx="5.5" cy="12" r="2.2"/><circle cx="18.5" cy="6" r="2.2"/><circle cx="18.5" cy="18" r="2.2"/><path d="M7.7 12h2.3c2.4 0 2.6-6 5-6h1.3M10 12c2.4 0 2.6 6 5 6h1.3"/>`,
  book: `<path d="M3.5 5.5H9a3 3 0 0 1 3 3v11a2.5 2.5 0 0 0-2.5-2.5h-6z"/><path d="M20.5 5.5H15a3 3 0 0 0-3 3v11a2.5 2.5 0 0 1 2.5-2.5h6z"/>`,
  terminal: `<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7.5 9.5l3 2.5-3 2.5M12.5 15h4"/>`,
  bolt: `<path d="M13 3L5.5 13.5h5.5l-1 7.5 7.5-10.5H12z"/>`,
  lock: `<rect x="5.5" y="10.5" width="13" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  copy: `<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>`,
  bulb: `<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.1v.1h5v-.1c0-.8.4-1.5 1.1-2.1A6 6 0 0 0 12 3z"/>`,
  target: `<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3"/>`,
  insert: `<path d="M19 5v6.5a3 3 0 0 1-3 3H6.5"/><path d="M10 10.5l-4 4 4 4"/>`,
  code: `<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>`,
};

const FILL: Record<string, string> = {
  play: `<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.4-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z"/>`,
  stop: `<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>`,
  step: `<path d="M5.5 5.8v12.4a.8.8 0 0 0 1.2.7l9-6.2a.8.8 0 0 0 0-1.4l-9-6.2a.8.8 0 0 0-1.2.7z"/><rect x="17" y="5" width="2.2" height="14" rx="1"/>`,
};

export type IconName =
  | "menu" | "close" | "file" | "plus" | "tree" | "book" | "terminal" | "bolt" | "lock" | "check" | "copy" | "bulb"
  | "target" | "insert" | "code" | "play" | "stop" | "step";

/** Разметка иконки для вставки в innerHTML. */
export function iconSVG(name: IconName): string {
  const filled = name in FILL;
  const body = filled ? FILL[name] : STROKE[name];
  const paint = filled
    ? `fill="currentColor"`
    : `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`;
  return `<svg class="ico ico-${name}" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" ${paint}>${body}</svg>`;
}

/** Кнопка или подпись: иконка и текст рядом. */
export function withIcon<T extends HTMLElement>(el: T, name: IconName, text = ""): T {
  el.innerHTML = iconSVG(name);
  if (text) {
    const label = document.createElement("span");
    label.textContent = text;
    el.append(label);
  }
  return el;
}
