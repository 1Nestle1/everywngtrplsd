// Древо навыков: карта навыков по веткам «Код», «Растения», «Колония».
// Узлы — кнопки на холсте, связи — SVG-кривые, справа — карточка выбранного навыка.
// Карту можно тащить мышью и крутить колесом; Esc закрывает.

import { BRANCHES, ITEM_INFO, UNLOCKS, UNLOCK_BY_ID, unlockEffect, unlockGrants, type Branch, type Item, type UnlockSpec } from "./api";
import { fmt, h } from "./dom";
import { renderCode } from "./editor";
import { iconSVG, withIcon } from "./icons";
import type { World } from "./world";

const COL = 198;
const ROW = 82;
const NODE_W = 166;
const NODE_H = 58;
const PAD_X = 136;
const PAD_Y = 44;
const SVG_NS = "http://www.w3.org/2000/svg";

type NodeState = "locked" | "open" | "partial" | "learned";

export interface SkillTreeHooks {
  /** Навык, к которому сейчас ведёт цель внизу экрана. */
  goalTarget(): string | null;
  copy(code: string): void;
  insert(code: string): void;
  onToggle(open: boolean): void;
}

interface NodeView {
  spec: UnlockSpec;
  btn: HTMLButtonElement;
  pips: HTMLElement[];
  meta: HTMLSpanElement;
  x: number;
  y: number;
}

export class SkillTree {
  readonly el = h("section", "skilltree");
  private viewport = h("div", "sk-viewport");
  private canvas = h("div", "sk-canvas");
  private svg = document.createElementNS(SVG_NS, "svg");
  private lanes = h("div", "sk-lanes");
  private laneCounts = new Map<Branch, HTMLElement>();
  private summary = h("p", "sk-summary");
  private detail = h("aside", "sk-detail");
  private nodes = new Map<string, NodeView>();
  private edges: { from: string; to: string; path: SVGPathElement }[] = [];
  private selected = "loops";
  private key = "";
  private detailKey = "";
  private costRows: { item: Item; need: number; have: HTMLElement; bar: HTMLElement; row: HTMLElement }[] = [];
  private buyBtn: HTMLButtonElement | null = null;

  constructor(private world: World, private hooks: SkillTreeHooks) {
    this.el.hidden = true;
    this.el.setAttribute("aria-label", "Древо навыков");

    const head = h("header", "sk-head");
    const title = h("h2", "sk-title", "Древо навыков");
    const hint = h("span", "sk-hint", "Тащите карту мышью · T или Esc — закрыть");
    const close = withIcon(h("button", "icon-btn"), "close");
    close.title = "Закрыть (Esc)";
    close.onclick = () => this.close();
    head.append(title, this.summary, hint, close);

    const W = PAD_X + 9 * COL + NODE_W + 56;
    const H = PAD_Y * 2 + 5 * ROW + NODE_H;
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.svg.setAttribute("class", "sk-edges");
    this.svg.setAttribute("width", String(W));
    this.svg.setAttribute("height", String(H));
    this.lanes.style.height = `${H}px`;

    // Полосы веток и подписи слева
    for (const [id, b] of Object.entries(BRANCHES) as [Branch, (typeof BRANCHES)[Branch]][]) {
      const top = PAD_Y + b.rows[0] * ROW - 16;
      const height = ROW + NODE_H + 32;
      const band = h("div", "sk-band");
      Object.assign(band.style, { top: `${top}px`, height: `${height}px` });
      band.style.setProperty("--b", b.color);
      this.canvas.append(band);
      const label = h("div", "sk-lane");
      Object.assign(label.style, { top: `${top}px`, height: `${height}px` });
      label.style.setProperty("--b", b.color);
      const count = h("span", "sk-lane-count");
      label.append(h("span", "sk-lane-name", b.ru), count);
      this.laneCounts.set(id, count);
      this.lanes.append(label);
    }

    this.canvas.append(this.svg);
    for (const u of UNLOCKS) this.canvas.append(this.buildNode(u));
    for (const u of UNLOCKS)
      for (const r of u.requires) {
        const path = document.createElementNS(SVG_NS, "path");
        const a = this.nodes.get(r)!, b = this.nodes.get(u.id)!;
        const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
        const dx = Math.max(28, (x2 - x1) / 2);
        path.setAttribute("d", `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
        path.style.setProperty("--b", BRANCHES[u.branch].color);
        this.svg.append(path);
        this.edges.push({ from: r, to: u.id, path });
      }
    this.canvas.append(this.lanes);
    this.viewport.append(this.canvas);

    const body = h("div", "sk-body");
    body.append(this.viewport, this.detail);
    this.el.append(head, body);
    this.enablePan();
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(id?: string): void {
    const wasOpen = this.isOpen;
    this.el.hidden = false;
    this.select(id ?? (wasOpen ? this.selected : this.hooks.goalTarget() ?? this.selected));
    this.sync(true);
    this.centerOn(this.selected, wasOpen);
    if (!wasOpen) this.hooks.onToggle(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.hooks.onToggle(false);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Сколько навыков можно изучить прямо сейчас. */
  readyCount(): number {
    return UNLOCKS.filter((u) => this.ready(u)).length;
  }

  // --- Состояние узлов ---
  private state(u: UnlockSpec): NodeState {
    const lvl = this.world.level(u.id);
    if (lvl >= u.costs.length) return "learned";
    if (!this.world.visibleUnlock(u.id)) return "locked";
    return lvl > 0 ? "partial" : "open";
  }

  private ready(u: UnlockSpec): boolean {
    const s = this.state(u);
    const cost = this.world.unlockCost(u.id);
    return (s === "open" || s === "partial") && !!cost && this.world.canAfford(cost);
  }

  private buildNode(u: UnlockSpec): HTMLButtonElement {
    const x = PAD_X + u.at[0] * COL;
    const y = PAD_Y + u.at[1] * ROW;
    const btn = h("button", "sk-node");
    btn.dataset.id = u.id;
    btn.style.left = `${x}px`;
    btn.style.top = `${y}px`;
    btn.style.setProperty("--b", BRANCHES[u.branch].color);
    if (u.id === "beacon") btn.classList.add("sk-final");
    const meta = h("span", "sk-meta");
    const bottom = h("span", "sk-node-bottom");
    bottom.append(meta);
    const pips: HTMLElement[] = [];
    if (u.costs.length > 1) {
      const wrap = h("span", "sk-pips");
      wrap.title = `Уровней: ${u.costs.length}`;
      for (let i = 0; i < u.costs.length; i++) pips.push(wrap.appendChild(h("i")));
      bottom.append(wrap);
    }
    btn.append(h("span", "sk-flag", "цель"), h("span", "sk-name", u.ru), bottom);
    btn.onclick = () => this.select(u.id);
    btn.ondblclick = () => this.buy(u.id);
    this.nodes.set(u.id, { spec: u, btn, pips, meta, x, y });
    return btn;
  }

  private select(id: string): void {
    if (!UNLOCK_BY_ID.has(id)) return;
    this.selected = id;
    for (const [nid, n] of this.nodes) n.btn.classList.toggle("is-selected", nid === id);
    this.detailKey = "";
    this.renderDetail();
  }

  private buy(id: string): void {
    if (!this.world.buyUnlock(id)) return;
    const n = this.nodes.get(id)!;
    n.btn.classList.remove("just-learned");
    void n.btn.offsetWidth; // перезапуск анимации
    n.btn.classList.add("just-learned");
    setTimeout(() => n.btn.classList.remove("just-learned"), 900);
    this.sync(true);
    // Связи к открывшимся навыкам прорисовываются заново — длина пути нормирована к 1
    for (const e of this.edges) {
      if (e.from !== id) continue;
      e.path.setAttribute("pathLength", "1");
      e.path.classList.add("just-lit");
      setTimeout(() => {
        e.path.classList.remove("just-lit");
        e.path.removeAttribute("pathLength");
      }, 900);
    }
  }

  private centerOn(id: string, smooth: boolean): void {
    const n = this.nodes.get(id);
    if (!n) return;
    const left = n.x + NODE_W / 2 - this.viewport.clientWidth / 2;
    this.viewport.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
  }

  private enablePan(): void {
    let drag: { x: number; y: number; sl: number; st: number; moved: boolean } | null = null;
    this.viewport.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest(".sk-node")) return;
      drag = { x: e.clientX, y: e.clientY, sl: this.viewport.scrollLeft, st: this.viewport.scrollTop, moved: false };
      this.viewport.setPointerCapture(e.pointerId);
    });
    this.viewport.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      this.viewport.classList.add("is-panning");
      this.viewport.scrollLeft = drag.sl - dx;
      this.viewport.scrollTop = drag.st - dy;
    });
    const end = () => {
      drag = null;
      this.viewport.classList.remove("is-panning");
    };
    this.viewport.addEventListener("pointerup", end);
    this.viewport.addEventListener("pointercancel", end);
    // Вертикальное колесо листает карту вбок, если по высоте она помещается
    this.viewport.addEventListener(
      "wheel",
      (e) => {
        const v = this.viewport;
        if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || v.scrollHeight > v.clientHeight + 1) return;
        v.scrollLeft += e.deltaY;
        e.preventDefault();
      },
      { passive: false },
    );
    // Подписи веток остаются у левого края
    this.viewport.addEventListener("scroll", () => (this.lanes.style.transform = `translateX(${this.viewport.scrollLeft}px)`));
  }

  // --- Обновление ---
  sync(force = false): void {
    if (!this.isOpen && !force) return;
    const w = this.world;
    const goal = this.hooks.goalTarget();
    const key =
      goal +
      "|" +
      UNLOCKS.map((u) => {
        const cost = w.unlockCost(u.id);
        const bits = cost ? Object.entries(cost).map(([k, v]) => (w.inventory[k as Item] >= (v ?? 0) ? 1 : 0)).join("") : "";
        return `${u.id}:${w.level(u.id)}:${bits}`;
      }).join(",");
    if (force || key !== this.key) {
      this.key = key;
      this.renderNodes(goal);
    }
    this.renderDetail();
    this.updateCostRows();
  }

  private renderNodes(goal: string | null): void {
    const w = this.world;
    let learned = 0, ready = 0;
    const perBranch = new Map<Branch, [number, number]>();
    for (const [id, n] of this.nodes) {
      const u = n.spec;
      const s = this.state(u);
      const lvl = w.level(id);
      const isReady = this.ready(u);
      if (lvl > 0) learned++;
      if (isReady) ready++;
      const pb = perBranch.get(u.branch) ?? [0, 0];
      perBranch.set(u.branch, [pb[0] + (lvl > 0 ? 1 : 0), pb[1] + 1]);
      n.btn.dataset.state = s;
      n.btn.classList.toggle("is-ready", isReady);
      n.btn.classList.toggle("is-goal", id === goal && s !== "learned");
      n.pips.forEach((p, i) => p.classList.toggle("on", i < lvl));
      n.btn.setAttribute("aria-label", `${u.ru}: ${this.stateText(u, s)}`);

      n.meta.innerHTML = "";
      n.meta.title = "";
      if (s === "learned") {
        n.meta.innerHTML = iconSVG("check");
        n.meta.append(h("span", "", u.costs.length > 1 ? "Все уровни" : "Изучено"));
      } else if (s === "locked") {
        const miss = u.requires.find((r) => !w.has(r))!;
        n.meta.innerHTML = iconSVG("lock");
        n.meta.append(h("span", "", UNLOCK_BY_ID.get(miss)!.ru));
        n.meta.title = `Сначала изучите «${UNLOCK_BY_ID.get(miss)!.ru}»`;
      } else {
        for (const [k, v] of Object.entries(w.unlockCost(id)!)) {
          const it = k as Item;
          const c = h("span", "sk-cost", fmt(v ?? 0));
          c.style.setProperty("--c", ITEM_INFO[it].color);
          c.title = ITEM_INFO[it].ru;
          if (w.inventory[it] < (v ?? 0)) c.classList.add("short");
          n.meta.append(c);
        }
      }
    }
    for (const e of this.edges) {
      const cls = w.has(e.to) ? "lit" : w.has(e.from) ? "open" : "dim";
      for (const c of ["lit", "open", "dim"]) e.path.classList.toggle(c, c === cls);
    }
    for (const [b, [got, total]] of perBranch) this.laneCounts.get(b)!.textContent = `${got} из ${total}`;
    this.summary.textContent = `Изучено ${learned} из ${UNLOCKS.length}` + (ready ? ` · можно изучить: ${ready}` : "");
  }

  private stateText(u: UnlockSpec, s: NodeState): string {
    if (s === "learned") return "изучено";
    if (s === "locked") return "закрыто";
    return this.ready(u) ? "можно изучить" : "не хватает ресурсов";
  }

  private renderDetail(): void {
    const w = this.world;
    const u = UNLOCK_BY_ID.get(this.selected)!;
    const s = this.state(u);
    const lvl = w.level(u.id);
    const key = `${u.id}:${lvl}:${s}`;
    if (key === this.detailKey) return;
    this.detailKey = key;
    const d = this.detail;
    d.innerHTML = "";
    d.style.setProperty("--b", BRANCHES[u.branch].color);
    this.costRows = [];
    this.buyBtn = null;

    d.append(h("h3", "sk-d-title", u.ru));
    const meta = h("p", "sk-d-meta");
    const dot = h("i", "sk-d-dot");
    meta.append(dot, `${BRANCHES[u.branch].ru}`);
    if (u.costs.length > 1) meta.append(` · уровень ${lvl} из ${u.costs.length}`);
    d.append(meta, h("p", "sk-d-desc", u.desc));
    const effect = unlockEffect(u.id, lvl);
    if (effect) d.append(h("p", "sk-d-effect", effect));

    const grants = unlockGrants(u.id);
    if (grants.lang.length || grants.code.length) {
      const sec = h("section", "sk-d-sec");
      sec.append(h("h4", "", "Открывает в коде"));
      const list = h("div", "sk-grants");
      for (const l of grants.lang) list.append(h("span", "sk-grant lang", l));
      for (const c of grants.code) list.append(h("code", "sk-grant", c));
      sec.append(list);
      d.append(sec);
    }

    const cost = w.unlockCost(u.id);
    if (cost) {
      const sec = h("section", "sk-d-sec");
      sec.append(h("h4", "", u.costs.length > 1 ? `Цена уровня ${lvl + 1}` : "Цена"));
      for (const [k, v] of Object.entries(cost)) {
        const it = k as Item;
        const row = h("div", "sk-need");
        row.style.setProperty("--c", ITEM_INFO[it].color);
        const have = h("span", "sk-need-num");
        const bar = h("i");
        const track = h("span", "sk-need-bar");
        track.append(bar);
        row.append(h("span", "sk-need-name", ITEM_INFO[it].ru), have, track);
        sec.append(row);
        this.costRows.push({ item: it, need: v ?? 0, have, bar, row });
      }
      d.append(sec);
    }

    if (s === "learned") {
      d.append(withIcon(h("p", "sk-d-status done"), "check", u.costs.length > 1 ? "Изучены все уровни" : "Навык изучен"));
    } else if (s === "locked") {
      const miss = u.requires.filter((r) => !w.has(r)).map((r) => `«${UNLOCK_BY_ID.get(r)!.ru}»`).join(" и ");
      d.append(withIcon(h("p", "sk-d-status"), "lock", `Сначала изучите ${miss}`));
    } else {
      const btn = h("button", "sk-buy");
      btn.onclick = () => this.buy(u.id);
      this.buyBtn = btn;
      d.append(btn);
    }

    if (u.example) {
      const sec = h("section", "sk-d-sec");
      sec.append(h("h4", "", s === "learned" || s === "partial" ? "Как пользоваться" : "Что можно будет написать"));
      const pre = h("pre", "code-block");
      renderCode(pre, u.example);
      const actions = h("div", "code-actions");
      const copy = withIcon(h("button", "text-btn"), "copy", "Копировать");
      copy.onclick = () => this.hooks.copy(u.example!);
      actions.append(copy);
      if (w.has(u.id)) {
        const ins = withIcon(h("button", "text-btn"), "insert", "Вставить в main");
        ins.onclick = () => this.hooks.insert(u.example!);
        actions.append(ins);
      }
      sec.append(pre, actions);
      d.append(sec);
    }
    this.updateCostRows();
  }

  private updateCostRows(): void {
    const w = this.world;
    let missing = 0;
    for (const r of this.costRows) {
      const have = Math.floor(w.inventory[r.item]);
      const text = `${fmt(Math.min(have, r.need))} / ${fmt(r.need)}`;
      if (r.have.textContent !== text) r.have.textContent = text;
      r.bar.style.width = `${Math.min(100, (have / r.need) * 100)}%`;
      r.row.classList.toggle("met", have >= r.need);
      if (have < r.need) missing++;
    }
    if (this.buyBtn) {
      const u = UNLOCK_BY_ID.get(this.selected)!;
      const lvl = w.level(u.id);
      const label = missing ? "Не хватает ресурсов" : u.costs.length > 1 ? `Изучить уровень ${lvl + 1}` : "Изучить";
      if (this.buyBtn.textContent !== label) this.buyBtn.textContent = label;
      this.buyBtn.disabled = missing > 0;
    }
  }
}
