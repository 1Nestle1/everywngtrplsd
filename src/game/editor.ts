// Редактор кода на CodeMirror 6: подсветка Python, автодополнение по открытым
// функциям и подсветка исполняемой строки или строки с ошибкой.

import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, indentUnit, syntaxHighlighting, bracketMatching } from "@codemirror/language";
import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, keymap, lineNumbers, highlightActiveLine, type DecorationSet } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const setRunLine = StateEffect.define<{ line: number; kind: "run" | "err" } | null>();

const runLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setRunLine)) continue;
      if (!e.value || e.value.line < 1 || e.value.line > tr.state.doc.lines) return Decoration.none;
      const line = tr.state.doc.line(e.value.line);
      deco = Decoration.set([Decoration.line({ class: e.value.kind === "run" ? "cm-run-line" : "cm-err-line" }).range(line.from)]);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "#ff9d5c" },
  { tag: [t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: "#ff9d5c" },
  { tag: t.comment, color: "#6b7390", fontStyle: "italic" },
  { tag: t.string, color: "#a8e07b" },
  { tag: t.number, color: "#ffd166" },
  { tag: [t.bool, t.null], color: "#ffd166" },
  { tag: t.function(t.variableName), color: "#7fd8ff" },
  { tag: t.definition(t.variableName), color: "#e6e9f2" },
  { tag: t.propertyName, color: "#c69bff" },
  { tag: t.operator, color: "#b3bad1" },
]);

const theme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "13.5px", backgroundColor: "transparent", color: "#e6e9f2" },
    ".cm-content": { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantLigatures: "none", caretColor: "#ffb547", padding: "6px 0" },
    ".cm-scroller": { fontFamily: "'JetBrains Mono', ui-monospace, monospace", lineHeight: "1.55" },
    ".cm-gutters": { backgroundColor: "transparent", color: "#4b5270", border: "none" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.03)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#9aa3c0" },
    ".cm-cursor": { borderLeftColor: "#ffb547", borderLeftWidth: "2px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "rgba(92,225,230,0.18) !important" },
    ".cm-run-line": { backgroundColor: "rgba(255,181,71,0.16)", boxShadow: "inset 3px 0 0 #ffb547" },
    ".cm-err-line": { backgroundColor: "rgba(255,92,92,0.18)", boxShadow: "inset 3px 0 0 #ff5c5c" },
    ".cm-tooltip": { backgroundColor: "#121524", border: "1px solid #2a3050", color: "#e6e9f2" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "#2a3050", color: "#fff" },
    ".cm-completionDetail": { color: "#7f88a8", fontStyle: "normal", marginLeft: "8px" },
    ".cm-matchingBracket": { backgroundColor: "rgba(92,225,230,0.2)", outline: "none" },
  },
  { dark: true },
);

export interface CompletionItem {
  label: string;
  type: string;
  detail?: string;
  info?: string;
}

export function createEditor(
  parent: HTMLElement,
  doc: string,
  opts: { onChange: (text: string) => void; onRun: () => void; completions: () => CompletionItem[] },
): { view: EditorView; setLine: (line: number, kind: "run" | "err" | null) => void } {
  const complete = (ctx: CompletionContext) => {
    const word = ctx.matchBefore(/[A-Za-z_][A-Za-z_0-9.]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const dot = word.text.lastIndexOf(".");
    const items = opts.completions().filter((c) => (dot >= 0 ? c.label.startsWith(word.text.slice(0, dot + 1)) : !c.label.includes(".")));
    return {
      from: dot >= 0 ? word.from + dot + 1 : word.from,
      options: items.map((c) => ({ ...c, label: dot >= 0 ? c.label.slice(dot + 1) : c.label })),
      validFor: /^[A-Za-z_0-9]*$/,
    };
  };
  const extensions: Extension[] = [
    lineNumbers(),
    history(),
    highlightActiveLine(),
    bracketMatching(),
    python(),
    indentUnit.of("    "),
    EditorState.tabSize.of(4),
    syntaxHighlighting(highlight),
    autocompletion({ override: [complete], icons: false }),
    runLineField,
    theme,
    keymap.of([
      { key: "Mod-Enter", run: () => (opts.onRun(), true) },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString());
    }),
  ];
  const view = new EditorView({ state: EditorState.create({ doc, extensions }), parent });
  let last = "";
  return {
    view,
    setLine(line, kind) {
      const key = kind ? `${kind}:${line}` : "";
      if (key === last) return;
      last = key;
      view.dispatch({ effects: setRunLine.of(kind ? { line, kind } : null) });
    },
  };
}
