"use client";

import { useEffect, useRef } from "react";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { crosshairCursor, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, rectangularSelection } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { LangId } from "app/lib/languages";

const LANG_EXT: Record<LangId, () => Extension> = {
  python: () => python(),
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  c: () => cpp(),
  cpp: () => cpp(),
  go: () => go(),
  rust: () => rust(),
  java: () => java(),
};
const INDENT: Record<LangId, string> = { python: "    ", javascript: "  ", typescript: "  ", c: "    ", cpp: "    ", go: "\t", rust: "    ", java: "    " };

// Token colors: the accent for keywords, muted neutrals for punctuation and comments. CSS variables switch with the theme.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: "var(--tok-keyword)" },
  { tag: [t.string, t.special(t.string), t.character, t.regexp], color: "var(--tok-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--tok-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--tok-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: "var(--tok-function)" },
  { tag: [t.definition(t.variableName), t.definition(t.function(t.variableName))], color: "var(--tok-def)" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: "var(--tok-type)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--tok-property)" },
  { tag: [t.processingInstruction, t.meta, t.annotation], color: "var(--tok-meta)" },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: "var(--tok-punct)" },
  { tag: t.invalid, color: "#ef4444" },
]);

export type EditorHandle = { setCode: (code: string) => void; focus: () => void };

export function Editor({
  lang,
  initial,
  onChange,
  onRun,
  handle,
  label,
}: {
  lang: LangId;
  initial: string;
  onChange: (code: string) => void;
  onRun: () => void;
  handle: React.RefObject<EditorHandle | null>;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const cb = useRef({ onChange, onRun });
  cb.current = { onChange, onRun };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(),
          foldGutter(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion({ activateOnTyping: false }),
          rectangularSelection(),
          crosshairCursor(),
          highlightSelectionMatches(),
          syntaxHighlighting(highlight),
          EditorState.tabSize.of(4),
          language.current.of([LANG_EXT[lang](), indentUnit.of(INDENT[lang])]),
          keymap.of([
            { key: "Mod-Enter", preventDefault: true, run: () => (cb.current.onRun(), true) },
            { key: "Shift-Enter", preventDefault: true, run: () => (cb.current.onRun(), true) },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((u) => u.docChanged && cb.current.onChange(u.state.doc.toString())),
          EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
        ],
      }),
    });
    view.current = v;
    handle.current = {
      // A replace transaction, not a new state, so Undo brings the old code back.
      setCode: (code) => v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: code }, selection: { anchor: 0 }, scrollIntoView: true }),
      focus: () => v.focus(),
    };
    return () => {
      v.destroy();
      view.current = null;
      handle.current = null;
    };
    // The view is created once; language and contents change through transactions below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: language.current.reconfigure([LANG_EXT[lang](), indentUnit.of(INDENT[lang])]) });
  }, [lang]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
