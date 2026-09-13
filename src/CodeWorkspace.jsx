import React, { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Play, Square, Copy } from "lucide-react";
import { useAppearance, currentAppearance } from "./appearance";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/languages/definitions/python/register";
import "monaco-editor/languages/definitions/cpp/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
globalThis.MonacoEnvironment = { getWorker: () => new EditorWorker() };
// Adapted to Recall's surfaces, with distinct semantic colors in each mode.
for (const [name, dark, palette] of [
  [
    "forest-dark",
    true,
    {
      bg: "#18231e",
      text: "#e8eee6",
      comment: "#8c9e8f",
      keyword: "#d699b6",
      string: "#dbbc7f",
      number: "#e6ae81",
      type: "#a7c080",
      line: "#223128",
      selection: "#405841",
      cursor: "#b6d2aa",
      border: "#536957",
    },
  ],
  [
    "forest-light",
    false,
    {
      bg: "#f7f8ef",
      text: "#26382d",
      comment: "#60735f",
      keyword: "#97547d",
      string: "#82611b",
      number: "#a45c2a",
      type: "#48743c",
      line: "#edf1e5",
      selection: "#d3e2c8",
      cursor: "#446a43",
      border: "#8da184",
    },
  ],
]) {
  const hex = (v) => v.slice(1);
  monaco.editor.defineTheme(name, {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      {
        token: "comment",
        foreground: hex(palette.comment),
        fontStyle: "italic",
      },
      { token: "keyword", foreground: hex(palette.keyword) },
      { token: "string", foreground: hex(palette.string) },
      { token: "number", foreground: hex(palette.number) },
      { token: "type", foreground: hex(palette.type) },
      { token: "type.identifier", foreground: hex(palette.type) },
      { token: "identifier", foreground: hex(palette.text) },
      { token: "delimiter", foreground: hex(palette.comment) },
      { token: "delimiter.curly", foreground: hex(palette.comment) },
      { token: "delimiter.bracket", foreground: hex(palette.comment) },
      { token: "delimiter.parenthesis", foreground: hex(palette.comment) },
    ],
    colors: {
      "editor.background": palette.bg,
      "editor.foreground": palette.text,
      "editorLineNumber.foreground": palette.comment,
      "editorLineNumber.activeForeground": palette.text,
      "editor.lineHighlightBackground": palette.line,
      "editor.selectionBackground": palette.selection,
      "editor.inactiveSelectionBackground": palette.selection + "80",
      "editorCursor.foreground": palette.cursor,
      "editorWidget.background": palette.bg,
      "editorWidget.foreground": palette.text,
      "editorWidget.border": palette.border,
      "editorSuggestWidget.background": palette.bg,
      "editorSuggestWidget.foreground": palette.text,
      "editorSuggestWidget.selectedBackground": palette.line,
      "editorHoverWidget.background": palette.bg,
      "editorHoverWidget.foreground": palette.text,
      "editorGutter.background": palette.bg,
      "editorIndentGuide.background1": palette.border + "50",
      "editorIndentGuide.activeBackground1": palette.border,
      "editorOverviewRuler.border": "#00000000",
      focusBorder: palette.cursor,
    },
  });
}
monaco.editor.setTheme("forest-" + currentAppearance());
export function HighlightedCode({ code, language }) {
  const [html, setHtml] = useState("");
  const appearance = useAppearance();
  useEffect(() => {
    let active = true;
    monaco.editor.setTheme("forest-" + appearance);
    monaco.editor
      .colorize(code, language, { theme: "forest-" + appearance })
      .then((value) => {
        if (active) setHtml(DOMPurify.sanitize(value));
      });
    return () => {
      active = false;
    };
  }, [code, language, appearance]);
  return (
    <pre
      className="highlighted-reference"
      aria-label="Reference implementation code"
    >
      {html ? <code dangerouslySetInnerHTML={{ __html: html }} /> : code}
    </pre>
  );
}
export default function CodeWorkspace({ card, revealed, onError }) {
  const appearance = useAppearance();
  const [language, setLanguage] = useState(() =>
      card.code.python ? "python" : Object.keys(card.code)[0],
    ),
    [result, setResult] = useState(null),
    [running, setRunning] = useState(false),
    [copied, setCopied] = useState("");
  const container = useRef(),
    editor = useRef();
  const revision = useRef(0);
  useEffect(() => {
    let disposed = false;
    const key = "draft:" + card.id + ":" + language;
    const e = monaco.editor.create(container.current, {
      value: "",
      editContext: false,
      language: language === "cpp" ? "cpp" : "python",
      theme: "forest-" + currentAppearance(),
      automaticLayout: true,
      minimap: { enabled: false },
      bracketPairColorization: { enabled: false },
      fontSize: 14,
      lineHeight: 24,
      padding: { top: 22, bottom: 18 },
      renderLineHighlight: "gutter",
      smoothScrolling: false,
      cursorSmoothCaretAnimation: "off",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollBeyondLastLine: false,
      tabSize: 4,
      wordWrap: "on",
      fontFamily: "Menlo, monospace",
    });
    editor.current = e;
    window.recall
      .draft(key)
      .then((value) => {
        if (!disposed) e.setValue(value ?? card.code[language].stub);
      })
      .catch(onError);
    const sub = e.onDidChangeModelContent(() => {
      revision.current++;
      setResult((previous) =>
        previous ? { ...previous, edited: true } : null,
      );
      window.recall.setting(key, e.getValue()).catch(onError);
    });
    return () => {
      disposed = true;
      sub.dispose();
      e.dispose();
    };
  }, [card.id, language]);
  useEffect(
    () => () => {
      window.recall.stop();
    },
    [],
  );
  useEffect(() => {
    monaco.editor.setTheme("forest-" + appearance);
  }, [appearance]);
  const run = async () => {
    setRunning(true);
    setResult(null);
    const version = revision.current;
    try {
      const r = await window.recall.run(
        card.id,
        language,
        editor.current.getValue(),
      );
      setResult({ ...r, edited: revision.current !== version });
    } catch (e) {
      onError(e);
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="code-workspace">
      <div className="editor-bar">
        <span>
          {card.code[language].filename ||
            `exercise.${language === "python" ? "py" : "cpp"}`}
        </span>
        <button
          onClick={() =>
            window.recall
              .copyChallengeCode(card.id, language, "stub")
              .then(() => setCopied("Starter copied"))
              .catch(onError)
          }
        >
          <Copy size={13} /> Copy starter
        </button>
        <select
          aria-label="Code language"
          value={language}
          disabled={running}
          onChange={(e) => {
            setResult(null);
            setLanguage(e.target.value);
          }}
        >
          {Object.keys(card.code).map((l) => (
            <option key={l} value={l}>
              {l === "cpp" ? "C++17" : "Python"}
            </option>
          ))}
        </select>
      </div>
      <div ref={container} className="monaco-host" />
      <div className="run-bar">
        <button className="primary" onClick={run} disabled={running}>
          <Play size={14} /> {running ? "Running…" : "Run tests"}
        </button>
        {running && (
          <button onClick={() => window.recall.stop()}>
            <Square size={13} /> Stop
          </button>
        )}
        <small>
          Everforest · {appearance === "dark" ? "Forest" : "Sage"} · runs on
          your Mac
        </small>
      </div>
      {result && (
        <div className={"run-result " + result.status} role="status">
          <strong>
            {result.phase === "compile" ? "Compiler · " : ""}
            {result.status}
            {result.edited ? " · code changed since this run" : ""}
          </strong>
          <pre>{result.output}</pre>
        </div>
      )}
      {copied && <small role="status">{copied}</small>}
      {revealed && (
        <details open className="reference">
          <summary>Reference implementation</summary>
          <button
            className="copy-code"
            onClick={() =>
              window.recall
                .copyChallengeCode(card.id, language, "solution")
                .then(() => setCopied("Reference copied"))
                .catch(onError)
            }
          >
            Copy reference
          </button>
          <HighlightedCode
            code={card.code[language].solution}
            language={language}
          />
        </details>
      )}
    </div>
  );
}
