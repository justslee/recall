import React, { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { WidgetFrame } from "./WidgetFrame";
import renderMath from "katex/contrib/auto-render";
import "katex/dist/katex.min.css";
import mermaid from "mermaid";
import { useAppearance, surfaceTokens } from "./appearance";
function configureDiagrams(appearance) {
  const color = surfaceTokens();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    htmlLabels: false,
    flowchart: {
      htmlLabels: false,
      curve: "basis",
      nodeSpacing: 24,
      rankSpacing: 34,
      wrappingWidth: 200,
    },
    themeVariables: {
      darkMode: appearance === "dark",
      background: color("sunken"),
      primaryColor: color("raised"),
      primaryTextColor: color("text"),
      primaryBorderColor: color("border-strong"),
      secondaryColor: color("card"),
      tertiaryColor: color("sunken"),
      textColor: color("text"),
      edgeLabelBackground: color("sunken"),
      lineColor: color("accent"),
      fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    },
  });
}
function HtmlContent({ html }) {
  const ref = useRef();
  useEffect(() => {
    // Imported notes sometimes leave runs of blank lines where an ASCII
    // diagram was lifted out; collapse them so paragraphs keep even rhythm.
    const source = (html || "").replace(/\n{3,}/g, "\n\n").trim();
    ref.current.innerHTML = DOMPurify.sanitize(source, {
      FORBID_TAGS: ["style", "iframe", "form", "input", "button", "script"],
      FORBID_ATTR: ["style"],
      ALLOW_DATA_ATTR: false,
    });
    ref.current.querySelectorAll("a").forEach((a) => {
      a.removeAttribute("href");
      a.title = "Source link preserved in card metadata";
    });
    ref.current.querySelectorAll("img").forEach((img) => {
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(img.src)) {
        img.replaceWith(
          document.createTextNode("[Image requires local import]"),
        );
      }
    });
    renderMath(ref.current, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
      trust: false,
    });
  }, [html]);
  return <div className="rich" ref={ref} />;
}
// Blocks lifted out of the sanitized prose: Mermaid fences, <pre class="mermaid">,
// ```widget fences (sandboxed frames) and inline <svg> figures (SVG-profile
// sanitizer, which keeps <style> so authored diagrams stay styled).
const BLOCKS =
  /```mermaid[^\S\n]*\r?\n(?<mermaid>[\s\S]*?)```|<pre\b[^>]*class=["']mermaid["'][^>]*>(?<pre>[\s\S]*?)<\/pre>|```widget[^\S\n]*(?<title>[^\n]*)\r?\n(?<widget>[\s\S]*?)```|(?<svg><svg\b[\s\S]*?<\/svg>)/gi;
export function RichContent({
  html,
  cardId,
  widgetsAllowed = false,
  revision,
}) {
  const text = html || "";
  const blocks = [];
  let cursor = 0,
    widgetIndex = 0;
  for (const match of text.matchAll(BLOCKS)) {
    if (match.index > cursor)
      blocks.push(
        <HtmlContent
          key={"html-" + cursor}
          html={text.slice(cursor, match.index)}
        />,
      );
    const g = match.groups;
    if (g.widget !== undefined) {
      blocks.push(
        <WidgetFrame
          key={"widget-" + match.index}
          cardId={cardId}
          index={widgetIndex++}
          title={g.title.trim() || "Interactive widget"}
          allowed={widgetsAllowed}
          revision={revision}
        />,
      );
    } else if (g.svg !== undefined) {
      blocks.push(<SvgFigure key={"svg-" + match.index} markup={g.svg} />);
    } else {
      let source = g.mermaid ?? g.pre;
      if (g.pre !== undefined) {
        const decoder = document.createElement("textarea");
        decoder.innerHTML = source;
        source = decoder.value;
      }
      blocks.push(
        <Diagram key={"diagram-" + match.index} source={source.trim()} />,
      );
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length || !blocks.length)
    blocks.push(
      <HtmlContent key={"html-" + cursor} html={text.slice(cursor)} />,
    );
  return <>{blocks}</>;
}
const sanitizeSvg = (svg) =>
  DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });

/** Zoomable viewer for already-sanitized SVG markup. */
function SvgViewer({ markup, error, label = "Rendered diagram" }) {
  const ref = useRef();
  const [zoom, setZoom] = useState(1);
  const fit = (factor) => {
    const svg = ref.current?.querySelector("svg");
    if (!svg) return;
    const box = svg.viewBox.baseVal;
    if (!box.width || !box.height) return;
    const width =
      Math.min(box.width, ref.current.parentElement.clientWidth - 40) * factor;
    svg.style.width = width + "px";
    svg.style.height = (width * box.height) / box.width + "px";
    svg.style.maxWidth = "none";
  };
  useEffect(() => {
    ref.current.innerHTML = markup || "";
    setZoom(1);
    fit(1);
  }, [markup]);
  useEffect(() => {
    fit(zoom);
    const observer = new ResizeObserver(() => fit(zoom));
    observer.observe(ref.current.parentElement);
    return () => observer.disconnect();
  }, [zoom, markup]);
  return (
    <div className="diagram-viewer">
      <div className="diagram-controls">
        <span>{label}</span>
        <button
          aria-label="Zoom out diagram"
          disabled={zoom <= 0.75}
          onClick={() => setZoom(Math.max(0.75, zoom - 0.25))}
        >
          −
        </button>
        <button aria-label="Reset diagram zoom" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button
          aria-label="Zoom in diagram"
          disabled={zoom >= 2}
          onClick={() => setZoom(Math.min(2, zoom + 0.25))}
        >
          +
        </button>
      </div>
      <div className="diagram-scroll">
        <div className="diagram" ref={ref} />
        {error && <p className="diagram-error">{error}</p>}
      </div>
    </div>
  );
}
/** An authored <svg> block from a card answer. */
export function SvgFigure({ markup }) {
  const clean = useMemo(() => sanitizeSvg(markup), [markup]);
  return <SvgViewer markup={clean} label="Figure" />;
}
export function Diagram({ source }) {
  const appearance = useAppearance();
  const [markup, setMarkup] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setError("");
    setMarkup("");
    configureDiagrams(appearance);
    mermaid
      .render("diagram-" + crypto.randomUUID(), source)
      .then(({ svg }) => live && setMarkup(sanitizeSvg(svg)))
      .catch(() => live && setError("This diagram needs a syntax correction."));
    return () => {
      live = false;
    };
  }, [source, appearance]);
  return <SvgViewer markup={markup} error={error} />;
}
export function CarryLab() {
  const [fx, setFx] = useState(135);
  const initial = 10000,
    asset = 10400,
    repayment = 1500000 / fx;
  return (
    <div className="lab">
      <span className="eyebrow">FOLLOW THE MONEY</span>
      <h3>Same asset. A different exchange rate.</h3>
      <p>
        Borrow ¥1.5m at 150 ¥/$ → invest $10,000 → receive $10,400. Ignore loan
        interest, tax and fees.
      </p>
      <label>
        Repayment USD/JPY <strong>{fx} ¥/$</strong>
        <input
          aria-label="Repayment exchange rate"
          type="range"
          min="110"
          max="170"
          value={fx}
          onChange={(e) => setFx(Number(e.target.value))}
        />
      </label>
      <div className="lab-metrics">
        <div>
          <small>Asset proceeds</small>
          <strong>${asset.toLocaleString()}</strong>
        </div>
        <div>
          <small>Buy ¥1.5m to repay</small>
          <strong>
            ${repayment.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </strong>
        </div>
        <div>
          <small>Net result</small>
          <strong>
            {asset - repayment < 0 ? "−" : "+"}$
            {Math.abs(asset - repayment).toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })}
          </strong>
        </div>
      </div>
      <p className="muted">
        At 150, the $400 asset gain survives. As yen strengthens and the quote
        falls, the dollar cost of repayment rises.
      </p>
    </div>
  );
}
