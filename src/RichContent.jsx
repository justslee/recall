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
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "maxEdges",
      "suppressErrorRendering",
      "theme",
      "themeCSS",
      "themeVariables",
      "htmlLabels",
    ],
    maxTextSize: 50000,
    maxEdges: 500,
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
      // No class either, so imported markup cannot dress up as app controls.
      FORBID_ATTR: ["style", "class"],
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
// sanitizer, rendered as an image so diagram CSS cannot style the app).
const BLOCKS =
  /```mermaid[^\S\n]*\r?\n(?<mermaid>[\s\S]*?)```|<pre\b[^>]*class=["']mermaid["'][^>]*>(?<pre>[\s\S]*?)<\/pre>|```widget[^\S\n]*(?<title>[^\n]*)\r?\n(?<widget>[\s\S]*?)```|(?<svg><svg\b[\s\S]*?<\/svg>)/gi;
// The main process numbers widgets with this exact grammar (electron/widgets.cjs
// FENCE); tests/security.test.cjs fails if the two drift. Counting fences
// before a position keeps frame N here equal to widget N there, even when an
// earlier fence sits inside a Mermaid or SVG block and is not shown.
const WIDGET_FENCE = /```widget[^\S\n]*([^\n]*)\r?\n([\s\S]*?)```/g;
const widgetIndexAt = (text, position) => {
  let n = 0;
  for (const m of text.matchAll(WIDGET_FENCE)) {
    if (m.index >= position) break;
    n++;
  }
  return n;
};
export function RichContent({
  html,
  cardId,
  widgetsAllowed = false,
  revision,
}) {
  const text = html || "";
  const blocks = [];
  let cursor = 0;
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
          index={widgetIndexAt(text, match.index)}
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

const SVG_NS = "http://www.w3.org/2000/svg";
const FIGURE_FAILED = "This figure couldn't be displayed.";

/** One broken figure shows a note in its place instead of blanking the app. */
class FigureBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous) {
    if (this.state.failed && previous.markup !== this.props.markup)
      this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? (
      <div className="diagram-viewer">
        <p className="diagram-error">{FIGURE_FAILED}</p>
      </div>
    ) : (
      this.props.children
    );
  }
}
function SvgViewer(props) {
  return (
    <FigureBoundary markup={props.markup}>
      <SvgImage {...props} />
    </FigureBoundary>
  );
}

/** SVG image documents cannot execute scripts, load remote resources or style the host. */
function SvgImage({ markup, error, label = "Rendered diagram" }) {
  const ref = useRef();
  const appearance = useAppearance();
  const figure = useMemo(() => {
    if (!markup) return null;
    // DOMPurify produced this markup with HTML rules, so read it back with
    // HTML rules. An XML parse rejects what HTML accepts: without xmlns the
    // root becomes a plain element with no style, and &nbsp; is an undefined
    // XML entity. A DOMParser document is inert: no scripts, styles or loads.
    const svg = new DOMParser().parseFromString(markup, "text/html").body
      .firstElementChild;
    if (svg?.namespaceURI !== SVG_NS || svg.localName !== "svg") return null;
    const theme = getComputedStyle(document.documentElement);
    for (const token of new Set(markup.match(/--[a-zA-Z][\w-]*/g) || [])) {
      const value = theme.getPropertyValue(token).trim();
      if (value) svg.style.setProperty(token, value);
    }
    svg.style.color = theme.getPropertyValue("--text").trim();
    const box = svg
      .getAttribute("viewBox")
      ?.trim()
      .split(/[\s,]+/)
      .map(Number);
    const width =
      box?.[2] > 0 ? box[2] : parseFloat(svg.getAttribute("width")) || 640;
    const height =
      box?.[3] > 0 ? box[3] : parseFloat(svg.getAttribute("height")) || 320;
    return {
      width,
      height,
      src:
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(new XMLSerializer().serializeToString(svg)),
    };
  }, [markup, appearance]);
  const [zoom, setZoom] = useState(1);
  const fit = (factor) => {
    const svg = ref.current;
    if (!svg || !figure) return;
    const width =
      Math.min(figure.width, svg.closest(".diagram-scroll").clientWidth - 40) *
      factor;
    svg.style.width = width + "px";
    svg.style.height = (width * figure.height) / figure.width + "px";
    svg.style.maxWidth = "none";
  };
  useEffect(() => {
    setZoom(1);
    fit(1);
  }, [figure]);
  useEffect(() => {
    fit(zoom);
    if (!ref.current) return;
    const observer = new ResizeObserver(() => fit(zoom));
    observer.observe(ref.current.closest(".diagram-scroll"));
    return () => observer.disconnect();
  }, [zoom, figure]);
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
        <div className="diagram">
          {figure && <img ref={ref} src={figure.src} alt={label} />}
        </div>
        {(error || (markup && !figure)) && (
          <p className="diagram-error">{error || FIGURE_FAILED}</p>
        )}
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
