import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  FileText,
  GitBranch,
  Minus,
  Orbit,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Scan,
} from "lucide-react";
import { plain } from "./model";
import {
  PAGE_SIZE,
  clamp,
  expertiseSummary,
  expertiseValue,
  normalizeGraph,
  graphLayout,
  anchoredZoom,
  curve,
  fitCamera,
  viewportNodes,
} from "./constellation-model";
import "./constellation.css";

const api = window.recall;
const identityCamera = () => ({ scale: 1, x: 0, y: 0 });
const formatNames = {
  all: "All formats",
  concept: "Concepts",
  math: "Math",
  code: "Coding",
};
const percent = (value) =>
  `${Math.round(clamp(Number(value) || 0, 0, 1) * 100)}%`;
const scoreLabel = (value) =>
  value == null ? "Unassessed" : `${expertiseValue(value)} expertise`;
const domainStyle = (domain) =>
  domain
    ? { "--domain-light": domain.light, "--domain-dark": domain.dark }
    : {};
const dateLabel = (value) => {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};
const relationLabel = (edge) =>
  String(edge.type || "related").replace(/[_-]/g, " ");

const DensityOrb = memo(function DensityOrb({ summary, small = false }) {
  const s = expertiseSummary(summary);
  const count =
    s.score == null
      ? 0
      : Math.max(s.assessed ? 4 : 0, Math.round(s.score * 0.74));
  const warning = s.needsPractice > 0;
  return (
    <svg
      className={`constellation-orb ${small ? "small" : ""}`}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <circle cx="50" cy="50" r="45" className="orb-halo" />
      <circle cx="50" cy="50" r="39" className="orb-body" />
      {count > 0 ? (
        <>
          <circle
            cx="50"
            cy="50"
            r="34"
            className="orb-core"
            style={{ opacity: 0.04 + (s.score / 100) * 0.13 }}
          />
          {Array.from({ length: count }, (_, i) => {
            const angle = i * 2.39996;
            const radius = 32 * Math.sqrt((i + 0.5) / count);
            const weak =
              warning && i < (count * s.needsPractice) / Math.max(1, s.total);
            return (
              <circle
                key={i}
                cx={50 + Math.cos(angle) * radius}
                cy={50 + Math.sin(angle) * radius}
                r={small ? 2.8 : 1.6 + (i % 3) * 0.3}
                className={weak ? "orb-point needs-practice" : "orb-point"}
                opacity={0.45 + (i % 5) * 0.11}
              />
            );
          })}
        </>
      ) : (
        <circle cx="50" cy="50" r="5" className="orb-unknown" />
      )}
      {warning && <circle cx="79" cy="75" r="5" className="orb-warning" />}
    </svg>
  );
});

export function Constellation({
  active,
  cards = [],
  onOpenNote,
  onCard,
  onNotes,
}) {
  const [focusId, setFocusId] = useState("root");
  const [format, setFormat] = useState("all");
  const [expandedIds, setExpandedIds] = useState([]);
  const [visibleIds, setVisibleIds] = useState([]);
  const [findQuery, setFindQuery] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(900);
  const [zoom, setZoom] = useState(100);
  const [motion, setMotion] = useState(true);
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const stage = useRef(null),
    canvas = useRef(null),
    anchors = useRef(new Map()),
    nodeElements = useRef(new Map()),
    windowKey = useRef(""),
    fitNext = useRef(true),
    fitFor = useRef(null),
    colors = useRef({});
  const sequence = useRef(0),
    camera = useRef(identityCamera()),
    phase = useRef(0);
  const visible = useRef(true),
    hovered = useRef(false),
    blockedClick = useRef(0);
  const navigate = useRef(null),
    redraw = useRef(null),
    motionRef = useRef(false);
  const selected = data?.focus;
  const shape = useMemo(
    () => (data ? graphLayout(data, width, anchors.current) : null),
    [data, width],
  );
  const cardLookup = useMemo(
    () => new Map(cards.map((c) => [c.id, c])),
    [cards],
  );
  motionRef.current = active && motion && !reduced;

  useEffect(() => {
    if (!active) return;
    const request = ++sequence.current;
    let disposed = false;
    setLoading(true);
    const timer = setTimeout(() => {
      Promise.resolve()
        .then(async () => {
          if (!api.constellation)
            throw Error(
              "This Recall runtime needs the Constellation update. Your notes are available in Notes.",
            );
          for (let attempt = 0; attempt < 3; attempt++) {
            const nodes = new Map(),
              edges = new Map();
            let offset = 0,
              edgeOffset = 0,
              first = null,
              complete = false;
            while (!disposed && request === sequence.current) {
              const value = await api.constellation({
                continuous: true,
                selectedId: focusId,
                expandedIds,
                format,
                offset,
                limit: PAGE_SIZE,
                edgeOffset,
                edgeLimit: 1000,
              });
              if (disposed || request !== sequence.current) return;
              if (
                !value?.focus ||
                !Array.isArray(value.nodes) ||
                !value.graphRevision
              )
                throw Error(
                  "The graph returned an incomplete continuous view. Update Recall or retry.",
                );
              if (first && value.graphRevision !== first.graphRevision) break;
              first ||= value;
              for (const node of value.nodes) nodes.set(node.id, node);
              for (const edge of value.edges || [])
                edges.set(
                  [edge.from, edge.to, edge.type, edge.status].join("\0"),
                  edge,
                );
              if (!value.hasMore && !value.hasMoreEdges) {
                complete = true;
                break;
              }
              const next = value.hasMore ? offset + value.nodes.length : offset;
              const nextEdge = value.hasMoreEdges
                ? edgeOffset + (value.edges?.length || 0)
                : edgeOffset;
              if (next === offset && nextEdge === edgeOffset)
                throw Error(
                  "The graph could not finish loading. Retry to refresh it.",
                );
              offset = next;
              edgeOffset = nextEdge;
            }
            if (disposed || request !== sequence.current) return;
            if (!complete) continue;
            const value = normalizeGraph({
              ...first,
              nodes: [...nodes.values()],
              edges: [...edges.values()],
              expandedIds,
            });
            if (value.focus.id !== value.rootId) value.nodes.push(value.focus);
            setData(value);
            setError("");
            return;
          }
          throw Error(
            "Your knowledge changed while the map was loading. Retry for a fresh view.",
          );
        })
        .catch((e) => {
          if (!disposed && request === sequence.current)
            setError(
              e.message?.replace(
                /^Error invoking remote method '[^']+': Error: /,
                "",
              ) || String(e),
            );
        })
        .finally(() => {
          if (!disposed && request === sequence.current) setLoading(false);
        });
    }, 60);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [active, focusId, expandedIds, format, epoch]);

  useEffect(() => {
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setEpoch((n) => n + 1), 120);
    };
    const offLibrary = api.onLibraryChanged?.(refresh);
    const offKnowledge = api.onKnowledgeEvent?.(refresh);
    return () => {
      clearTimeout(timer);
      offLibrary?.();
      offKnowledge?.();
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (!document.hidden) setEpoch((n) => n + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReduced(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (!stage.current) return;
    const element = stage.current;
    const resize = new ResizeObserver(() => {
      if (!element.clientWidth) return;
      fitNext.current = true;
      fitFor.current = null;
      setWidth(element.clientWidth);
    });
    resize.observe(element);
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
    });
    observer.observe(element);
    return () => {
      resize.disconnect();
      observer.disconnect();
    };
  }, [!!data]);

  const paint = useCallback(() => {
    if (!shape || !canvas.current) return;
    const c = camera.current;
    const viewport = viewportNodes(shape, c, width, shape.height);
    const key = viewport.map((n) => n.id).join("\0");
    if (windowKey.current !== key) {
      windowKey.current = key;
      setVisibleIds(viewport.map((n) => n.id));
    }
    const nodeIds = new Set(viewport.map((n) => n.id));
    const positions = shape.nodes.map((n, i) => {
      const amount = n.id === focusId || !motionRef.current ? 0 : 1.7;
      const x =
        (n.x + Math.sin(phase.current * 0.3 + i * 1.4) * amount) * c.scale +
        c.x;
      const y =
        (n.y + Math.cos(phase.current * 0.24 + i * 0.8) * amount) * c.scale +
        c.y;
      const element = nodeElements.current.get(n.id);
      if (element) {
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
      }
      return { ...n, x, y };
    });
    const context = canvas.current.getContext("2d");
    stage.current?.setAttribute(
      "data-in-view-count",
      String(
        positions.filter(
          (n) => n.x >= 0 && n.x <= width && n.y >= 0 && n.y <= shape.height,
        ).length,
      ),
    );
    if (!context) return;
    const ratio = Math.min(2, devicePixelRatio || 1);
    if (
      canvas.current.width !== Math.round(width * ratio) ||
      canvas.current.height !== Math.round(shape.height * ratio)
    ) {
      canvas.current.width = Math.round(width * ratio);
      canvas.current.height = Math.round(shape.height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, shape.height);
    const palette = colors.current;
    const byId = new Map(positions.map((n) => [n.id, n]));
    let pulses = 0;
    for (const edge of shape.edges) {
      const a = byId.get(edge.from),
        b = byId.get(edge.to);
      if (!a || !b) continue;
      if (
        Math.max(a.x, b.x) < -100 ||
        Math.min(a.x, b.x) > width + 100 ||
        Math.max(a.y, b.y) < -100 ||
        Math.min(a.y, b.y) > shape.height + 100
      )
        continue;
      const selectedEdge = a.id === focusId || b.id === focusId;
      const related = edge.type !== "hierarchy";
      const colorA =
        a.domain?.[palette.dark ? "dark" : "light"] || palette.accent;
      const colorB =
        b.domain?.[palette.dark ? "dark" : "light"] || palette.accent;
      const sameDomain = a.domain?.id === b.domain?.id;
      const inActiveDomain = a.context !== "other" && b.context !== "other";
      if (sameDomain) context.strokeStyle = colorA;
      else {
        const gradient = context.createLinearGradient(a.x, a.y, b.x, b.y);
        gradient.addColorStop(0, colorA);
        gradient.addColorStop(1, colorB);
        context.strokeStyle = gradient;
      }
      context.globalAlpha = selectedEdge
        ? 0.74
        : related
          ? 0.3
          : inActiveDomain
            ? 0.36
            : 0.17;
      context.lineWidth = selectedEdge ? 1.6 : related ? 0.8 : 1;
      context.setLineDash(edge.status === "suggested" ? [3, 6] : []);
      const cx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08,
        cy = (a.y + b.y) / 2 - (b.x - a.x) * 0.08;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.quadraticCurveTo(cx, cy, b.x, b.y);
      context.stroke();
      if (motionRef.current && selectedEdge && pulses++ < 24) {
        const t = (phase.current / 9 + pulses * 0.173) % 1,
          p = curve(a, b).point(t);
        context.globalAlpha = Math.sin(t * Math.PI) * 0.65;
        context.fillStyle = colorA;
        context.beginPath();
        context.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.setLineDash([]);
    for (const n of positions) {
      if (
        nodeIds.has(n.id) ||
        n.x < -30 ||
        n.x > width + 30 ||
        n.y < -30 ||
        n.y > shape.height + 30
      )
        continue;
      const r = Math.max(2.5, 24 * Math.min(1, c.scale));
      const domainColor =
        n.domain?.[palette.dark ? "dark" : "light"] || palette.accent;
      context.globalAlpha = 0.9;
      context.fillStyle = palette.card;
      context.beginPath();
      context.arc(n.x, n.y, r, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = domainColor;
      context.globalAlpha = n.context === "other" ? 0.52 : 0.86;
      context.lineWidth = n.role === "focus" ? 2.4 : 1.4;
      context.stroke();
      if (n.summary.score != null) {
        context.globalAlpha = 0.15 + n.summary.score / 140;
        context.fillStyle = domainColor;
        context.beginPath();
        context.arc(
          n.x,
          n.y,
          Math.max(1, r * (0.18 + n.summary.score / 150)),
          0,
          Math.PI * 2,
        );
        context.fill();
      }
      if (n.summary.needsPractice) {
        context.globalAlpha = 1;
        context.fillStyle = palette.warning;
        context.beginPath();
        context.arc(
          n.x + r * 0.68,
          n.y + r * 0.68,
          Math.max(1.8, r * 0.13),
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    }
    context.globalAlpha = 1;
  }, [shape, width, focusId]);
  redraw.current = paint;
  useLayoutEffect(() => {
    if (!shape || !stage.current) return;
    const updateColors = () => {
      const style = getComputedStyle(stage.current);
      colors.current = {
        accent: style.getPropertyValue("--accent").trim() || "#536b54",
        card: style.getPropertyValue("--card").trim() || "#f8f8f1",
        warning: style.getPropertyValue("--grade-hard").trim() || "#a58e53",
        dark: style.getPropertyValue("--constellation-dark").trim() === "1",
      };
      paint();
    };
    if (
      fitNext.current &&
      (!fitFor.current ||
        data.focus.id === fitFor.current ||
        data.redirectedFrom === fitFor.current)
    ) {
      camera.current = fitCamera(shape, width, shape.height);
      fitNext.current = false;
      fitFor.current = null;
      setZoom(Math.round(camera.current.scale * 100));
    }
    updateColors();
    const appearance = matchMedia("(prefers-color-scheme: dark)");
    appearance.addEventListener("change", updateColors);
    const observer = new MutationObserver(updateColors);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => {
      appearance.removeEventListener("change", updateColors);
      observer.disconnect();
    };
  }, [shape, paint, width, data]);
  useLayoutEffect(() => {
    paint();
  }, [paint, visibleIds, active, motion, reduced]);
  useEffect(() => {
    if (!active) return;
    let frame,
      previous = 0;
    const tick = (time) => {
      const delta = Math.min(50, time - previous || 0);
      previous = time;
      if (
        motionRef.current &&
        visible.current &&
        !document.hidden &&
        !hovered.current
      ) {
        phase.current += delta / 1000;
        redraw.current?.();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  const go = useCallback(
    (id) => {
      if (!id) return;
      setFocusId(id);
      if (id === "root") {
        camera.current = shape
          ? fitCamera(shape, width, shape.height)
          : identityCamera();
        setZoom(Math.round(camera.current.scale * 100));
      } else {
        const node = shape?.nodes.find((n) => n.id === id);
        setExpandedIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
        if (
          !node ||
          (node.childCount > 0 && !expandedIds.includes(id)) ||
          (shape?.nodes.length || 0) < 60
        ) {
          fitNext.current = true;
          fitFor.current = id;
        } else {
          const scale = Math.max(0.8, camera.current.scale);
          camera.current = {
            scale,
            x: width / 2 - node.x * scale,
            y: shape.height / 2 - 50 - node.y * scale,
          };
          setZoom(Math.round(scale * 100));
        }
      }
      if (id === focusId) setEpoch((n) => n + 1);
    },
    [focusId, shape, width, expandedIds],
  );
  navigate.current = go;
  const fit = () => {
    camera.current = shape
      ? fitCamera(shape, width, shape.height)
      : identityCamera();
    setZoom(Math.round(camera.current.scale * 100));
    paint();
  };
  const collapse = () => {
    fitNext.current = true;
    fitFor.current = focusId;
    const descendants = new Set([focusId]);
    for (let changed = true; changed;) {
      changed = false;
      for (const n of data?.nodes || [])
        if (descendants.has(n.parentId) && !descendants.has(n.id)) {
          descendants.add(n.id);
          changed = true;
        }
    }
    setExpandedIds((ids) => ids.filter((id) => !descendants.has(id)));
  };
  const changeZoom = (scale, point) => {
    const anchor = point || {
      x: (stage.current?.clientWidth || width) / 2,
      y: (stage.current?.clientHeight || 520) / 2,
    };
    camera.current = anchoredZoom(camera.current, scale, anchor);
    setZoom(Math.round(camera.current.scale * 100));
    redraw.current?.();
  };

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const points = new Map();
    let gesture = null,
      drag = null;
    const local = (e) => {
      const r = element.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const apply = (value) => {
      camera.current = value;
      setZoom(Math.round(value.scale * 100));
      redraw.current?.();
    };
    const wheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      apply(
        anchoredZoom(
          camera.current,
          camera.current.scale * Math.exp(-e.deltaY * 0.008),
          local(e),
        ),
      );
    };
    const gestureStart = (e) => {
      e.preventDefault();
      gesture = { scale: camera.current.scale };
    };
    const gestureChange = (e) => {
      e.preventDefault();
      const p = local(e);
      apply(
        anchoredZoom(
          camera.current,
          (gesture?.scale || camera.current.scale) * e.scale,
          Number.isFinite(p.x)
            ? p
            : { x: element.clientWidth / 2, y: element.clientHeight / 2 },
        ),
      );
    };
    const gestureEnd = (e) => {
      e.preventDefault();
      gesture = null;
    };
    const down = (e) => {
      if (e.pointerType !== "touch" && e.button !== 0) return;
      const p = local(e);
      points.set(e.pointerId, p);
      drag = {
        ...p,
        camera: { ...camera.current },
        node: e.target.closest(".constellation-node"),
        moved: false,
      };
      if (points.size === 2) {
        const [a, b] = [...points.values()];
        gesture = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          scale: camera.current.scale,
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          camera: { ...camera.current },
        };
        blockedClick.current = Date.now() + 600;
      }
      if (!drag.node || e.pointerType === "touch")
        element.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!points.has(e.pointerId)) return;
      const p = local(e);
      points.set(e.pointerId, p);
      if (points.size === 2 && gesture?.distance) {
        const [a, b] = [...points.values()];
        const scale = clamp(
          (gesture.scale * Math.hypot(a.x - b.x, a.y - b.y)) / gesture.distance,
          0.03,
          3.5,
        );
        const ratio = scale / gesture.scale;
        apply({
          scale,
          x: (a.x + b.x) / 2 - (gesture.x - gesture.camera.x) * ratio,
          y: (a.y + b.y) / 2 - (gesture.y - gesture.camera.y) * ratio,
        });
        drag.moved = true;
        blockedClick.current = Date.now() + 600;
      } else if (drag && (!drag.node || e.pointerType === "touch")) {
        const dx = p.x - drag.x,
          dy = p.y - drag.y;
        if (Math.hypot(dx, dy) > 5) drag.moved = true;
        if (drag.moved) {
          apply({
            ...camera.current,
            x: drag.camera.x + dx,
            y: drag.camera.y + dy,
          });
          element.classList.add("is-dragging");
          blockedClick.current = Date.now() + 500;
        }
      }
    };
    const end = (e) => {
      if (
        e.pointerType === "touch" &&
        drag?.node &&
        !drag.moved &&
        points.size === 1 &&
        Date.now() >= blockedClick.current
      ) {
        blockedClick.current = Date.now() + 450;
        navigate.current(drag.node.dataset.target);
      }
      points.delete(e.pointerId);
      if (points.size) {
        const p = [...points.values()][0];
        drag = { ...p, camera: { ...camera.current }, moved: true, node: null };
      } else drag = null;
      gesture = null;
      element.classList.remove("is-dragging");
    };
    const cancel = (e) => {
      points.delete(e.pointerId);
      drag = null;
      gesture = null;
      element.classList.remove("is-dragging");
    };
    const listeners = {
      wheel,
      gesturestart: gestureStart,
      gesturechange: gestureChange,
      gestureend: gestureEnd,
      pointerdown: down,
      pointermove: move,
      pointerup: end,
      pointercancel: cancel,
    };
    for (const [name, fn] of Object.entries(listeners))
      element.addEventListener(name, fn, { passive: false });
    return () => {
      for (const [name, fn] of Object.entries(listeners))
        element.removeEventListener(name, fn);
    };
  }, [!!data]);

  const summary = selected?.summary || expertiseSummary();
  const currentEdges =
    data?.edges.filter(
      (e) =>
        e.type !== "hierarchy" &&
        (e.from === selected.id || e.to === selected.id),
    ) || [];
  const nodeById = new Map(
    [...(data?.nodes || []), ...(selected ? [selected] : [])].map((n) => [
      n.id,
      n,
    ]),
  );
  const noteRefs = selected?.noteRefs || [];
  const linkedCards = (selected?.cardIds || [])
    .map((id) => cardLookup.get(id))
    .filter((card) => card && (format === "all" || card.kind === format));
  const rootFocus = selected?.id === data?.rootId;

  return (
    <section
      className="recall-constellation"
      aria-label="Constellation knowledge graph"
      hidden={!active}
    >
      <div className="constellation-toolbar">
        <div className="constellation-format">
          <label htmlFor="constellation-format">Practice evidence</label>
          <select
            id="constellation-format"
            value={format}
            onChange={(e) => {
              setFormat(e.target.value);
            }}
          >
            {Object.entries(formatNames).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <span className="constellation-model-label">
          Expertise index · Scored reviews · Model v1
        </span>
        <button
          className="constellation-motion"
          disabled={reduced}
          onClick={() => setMotion(!motion)}
          aria-pressed={!motion || reduced}
          aria-label={
            reduced
              ? "System reduced motion enabled"
              : motion
                ? "Pause graph motion"
                : "Resume graph motion"
          }
        >
          {motion && !reduced ? <Pause size={14} /> : <Play size={14} />}
          {reduced
            ? "Reduced motion"
            : motion
              ? "Pause motion"
              : "Resume motion"}
        </button>
      </div>
      {data?.knowledge && (
        <div className="constellation-knowledge-status" role="status">
          <span>
            {data.knowledge.noteCount || 0} indexed knowledge notes
            {data.knowledge.unmappedNoteCount > 0
              ? ` · ${data.knowledge.unmappedNoteCount} without linked practice`
              : ""}
          </span>
          {(data.knowledge.issues || []).slice(0, 3).map((issue, i) => (
            <span className="constellation-index-issue" key={i}>
              <AlertCircle size={13} /> {issue}
            </span>
          ))}
        </div>
      )}
      {error && (
        <div className="constellation-error" role="alert">
          <AlertCircle size={17} />
          <span>{error}</span>
          <button onClick={() => setEpoch((n) => n + 1)}>
            <RefreshCw size={14} />
            Retry
          </button>
          <button onClick={onNotes}>Open Notes</button>
        </div>
      )}
      {!data ? (
        <div className="constellation-empty" role="status">
          <Orbit size={36} />
          <h2>
            {loading
              ? "Gathering your constellation…"
              : "Your knowledge, connected."}
          </h2>
          <p>Concepts and their review evidence appear here.</p>
        </div>
      ) : (
        <>
          <div className="constellation-explore-bar">
            <label className="constellation-find">
              <span>Find on this canvas</span>
              <input
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                placeholder="Find a topic or idea…"
              />
            </label>
            {expandedIds.includes(focusId) && selected.childCount > 0 && (
              <button onClick={collapse}>Collapse branch</button>
            )}
            {expandedIds.length > 0 && (
              <button
                onClick={() => {
                  fitNext.current = true;
                  fitFor.current = "root";
                  setFocusId("root");
                  setExpandedIds([]);
                }}
              >
                Collapse all
              </button>
            )}
            {(data.holdingAreas || []).map((area) => (
              <button key={area.id} onClick={() => go(area.id)}>
                {plain(area.label)} · {area.childCount}
              </button>
            ))}
          </div>
          {findQuery && (
            <div
              className="constellation-find-results"
              role="listbox"
              aria-label="Matching canvas nodes"
            >
              {data.nodes
                .filter((n) =>
                  plain(n.label)
                    .toLocaleLowerCase()
                    .includes(findQuery.toLocaleLowerCase()),
                )
                .map((n) => (
                  <button
                    key={n.id}
                    role="option"
                    aria-selected={n.id === focusId}
                    onClick={() => {
                      go(n.id);
                      setFindQuery("");
                    }}
                  >
                    {plain(n.label)}
                  </button>
                ))}
              {!data.nodes.some((n) =>
                plain(n.label)
                  .toLocaleLowerCase()
                  .includes(findQuery.toLocaleLowerCase()),
              ) && (
                <p>
                  No matching node on this canvas. Expand a branch to explore
                  its ideas.
                </p>
              )}
            </div>
          )}
          <div className="constellation-navigation">
            <nav
              aria-label="Constellation hierarchy"
              className="constellation-breadcrumbs"
            >
              {[...data.ancestors, data.focus].map((n, i, list) => (
                <React.Fragment key={n.id}>
                  {i > 0 && <ChevronRight size={12} />}
                  <button
                    onClick={() => go(n.id)}
                    aria-current={i === list.length - 1 ? "page" : undefined}
                  >
                    {plain(n.label || n.title || "Untitled")}
                  </button>
                </React.Fragment>
              ))}
            </nav>
            <div
              className="constellation-camera"
              role="group"
              aria-label="Graph zoom"
            >
              <button
                onClick={() => changeZoom(camera.current.scale / 1.2)}
                aria-label="Zoom out"
              >
                <Minus size={15} />
              </button>
              <output aria-label="Zoom level">{zoom}%</output>
              <button
                onClick={() => changeZoom(camera.current.scale * 1.2)}
                aria-label="Zoom in"
              >
                <Plus size={15} />
              </button>
              <button onClick={fit}>
                <Scan size={14} />
                Fit all
              </button>
            </div>
          </div>
          <div className="constellation-domain-key">
            <div
              className="constellation-domains"
              role="group"
              aria-label="Knowledge domains"
            >
              <span className="constellation-key-label">Domains</span>
              {shape.domains.map((domain) => (
                <button
                  key={domain.id}
                  className="constellation-domain constellation-domain-chip"
                  style={domainStyle(domain)}
                  data-domain-id={domain.id}
                  aria-pressed={shape.activeDomain?.id === domain.id}
                  onClick={() => go(domain.id)}
                >
                  <i aria-hidden="true" />
                  {plain(domain.label)}
                </button>
              ))}
            </div>
            <p>
              Color shows domain · Density shows expertise · Hollow means
              unassessed
              {shape.activeDomain && (
                <span>Other domains stay visible for context.</span>
              )}
            </p>
          </div>
          <div
            className={`constellation-stage ${loading ? "is-loading" : ""}`}
            ref={stage}
            style={{ height: shape.height }}
            data-node-count={shape.nodes.length}
            data-edge-count={shape.edges.length}
            data-related-count={
              shape.edges.filter((e) => e.type !== "hierarchy").length
            }
            data-expanded={expandedIds.join(" ")}
            onClick={(e) => {
              if (
                e.target.closest("button") ||
                Date.now() < blockedClick.current
              )
                return;
              const box = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - box.left,
                y = e.clientY - box.top,
                c = camera.current;
              let closest = null,
                distance = Math.max(12, 24 * c.scale);
              for (const n of shape.nodes) {
                const d = Math.hypot(
                  n.x * c.scale + c.x - x,
                  n.y * c.scale + c.y - y,
                );
                if (d < distance) {
                  closest = n;
                  distance = d;
                }
              }
              if (closest) go(closest.id);
            }}
            tabIndex={0}
            aria-label="Concept graph. Pinch or press plus and minus to zoom, drag or use arrow keys to pan, F to fit. Choose a concept to explore."
            onKeyDown={(e) => {
              if (e.metaKey || e.ctrlKey || e.altKey) return;
              if (e.key === "+" || e.key === "=") {
                e.preventDefault();
                changeZoom(camera.current.scale * 1.2);
              } else if (e.key === "-") {
                e.preventDefault();
                changeZoom(camera.current.scale / 1.2);
              } else if (["f", "F", "0", "Home"].includes(e.key)) {
                e.preventDefault();
                fit();
              } else if (e.key.startsWith("Arrow")) {
                e.preventDefault();
                camera.current = {
                  ...camera.current,
                  x:
                    camera.current.x +
                    (e.key === "ArrowLeft"
                      ? 40
                      : e.key === "ArrowRight"
                        ? -40
                        : 0),
                  y:
                    camera.current.y +
                    (e.key === "ArrowUp"
                      ? 40
                      : e.key === "ArrowDown"
                        ? -40
                        : 0),
                };
                redraw.current?.();
              }
            }}
            onPointerEnter={() => {
              hovered.current = true;
            }}
            onPointerLeave={() => {
              hovered.current = false;
            }}
            onFocusCapture={() => {
              hovered.current = true;
            }}
            onBlurCapture={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget))
                hovered.current = false;
            }}
          >
            <span className="constellation-stage-title">
              {shape.nodes.length} nodes on this canvas
              {zoom < 55 ? " · Zoom in for labels" : " · Select to unfold"}
            </span>
            <canvas
              ref={canvas}
              className="constellation-canvas"
              aria-hidden="true"
            />
            {shape.nodes
              .filter((node) => visibleIds.includes(node.id))
              .map((node) => {
                const title = plain(node.label || node.title || "Untitled");
                return (
                  <button
                    key={node.id}
                    ref={(e) => {
                      if (e) nodeElements.current.set(node.id, e);
                      else nodeElements.current.delete(node.id);
                    }}
                    className={`constellation-node constellation-domain ${node.role} ${node.expanded ? "expanded" : ""} ${node.context === "other" ? "other-domain" : ""}`}
                    data-node-id={node.id}
                    data-domain-id={node.domain?.id || ""}
                    data-context={node.context}
                    data-target={node.id}
                    data-expertise={node.summary.score ?? "unassessed"}
                    style={{
                      ...domainStyle(node.domain),
                      left: node.x * camera.current.scale + camera.current.x,
                      top: node.y * camera.current.scale + camera.current.y,
                    }}
                    title={title}
                    aria-label={`Explore ${title}. ${node.domain ? `${plain(node.domain.label)} domain. ` : ""}${node.context === "other" ? "Other domain, retained for context. " : ""}${scoreLabel(node.summary.score)}. ${node.summary.assessed} of ${node.summary.total} assessed.${node.summary.needsPractice ? ` ${node.summary.needsPractice} need practice.` : ""}`}
                    aria-pressed={node.id === focusId}
                    aria-expanded={node.childCount ? node.expanded : undefined}
                    onClick={() => {
                      if (Date.now() >= blockedClick.current) go(node.id);
                    }}
                  >
                    {node.parentId === data.rootId && (
                      <span className="constellation-domain-context">
                        {node.context === "other"
                          ? "Other domain"
                          : "Level 1 domain"}
                      </span>
                    )}
                    <DensityOrb summary={node.summary} />
                    <span className="constellation-node-title">{title}</span>
                    <span className="constellation-node-score">
                      {scoreLabel(node.summary.score)}
                    </span>
                    {node.summary.assessed > 0 && (
                      <span
                        className={`constellation-node-evidence ${node.summary.needsPractice ? "needs-practice" : ""}`}
                      >
                        {node.summary.needsPractice
                          ? "Needs practice"
                          : `${node.summary.assessed}/${node.summary.total} assessed`}
                      </span>
                    )}
                    {node.childCount > 0 && (
                      <span className="constellation-node-context">
                        {node.expanded
                          ? "− expanded"
                          : `+ ${node.childCount} within`}
                      </span>
                    )}
                  </button>
                );
              })}
            {!data.nodes.length && rootFocus && (
              <div className="constellation-no-nodes">
                <Orbit size={32} />
                <h2>A place for connections.</h2>
                <p>Add knowledge notes or practice cards to begin your map.</p>
                <button onClick={onNotes}>
                  <FileText size={14} /> Open Notes
                </button>
              </div>
            )}
          </div>
          <div className="constellation-graph-footer">
            <span>
              Pinch to zoom · Drag to move · Select to unfold · F to fit all
            </span>
            <span className="constellation-edge-legend">
              <i />
              Hierarchy <i className="explicit" />
              Link <i className="suggested" />
              Suggested
            </span>
          </div>
          <div className="constellation-inspector" aria-live="polite">
            <div className="constellation-evidence">
              <span className="eyebrow">{formatNames[format]} evidence</span>
              <h2>
                {rootFocus
                  ? "Evidence behind the constellation"
                  : plain(selected.label || selected.title)}
              </h2>
              <div className="constellation-score-line">
                <strong>
                  {summary.score == null
                    ? "Unassessed"
                    : expertiseValue(summary.score)}
                </strong>
                {summary.score != null && <span>expertise index</span>}
              </div>
              <p>
                {summary.assessed} of {summary.total} mapped objectives assessed
                {summary.needsPractice
                  ? ` · ${summary.needsPractice} need practice`
                  : ""}
                .
              </p>
              <dl className="constellation-evidence-values">
                <div>
                  <dt>Coverage</dt>
                  <dd>{percent(summary.coverage)}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{percent(summary.confidence)}</dd>
                </div>
                <div>
                  <dt>Scored reviews</dt>
                  <dd>{summary.reviewCount}</dd>
                </div>
              </dl>
              <p className="constellation-scope">
                {summary.score == null
                  ? "Unassessed means no sufficient scored evidence, not low ability."
                  : "A provisional index within your mapped objectives. More cards alone do not establish broader expertise."}
              </p>
              {selected.inferred && (
                <p className="constellation-scope">
                  Grouped from existing topic tags. This branch has not been
                  assigned an explicit hierarchy yet.
                </p>
              )}
              {summary.reassessmentRequired && (
                <p className="constellation-reassessment">
                  The learning objective changed. Reassessment is needed.
                </p>
              )}
              {summary.lastReviewAt && (
                <p className="constellation-last-review">
                  Latest review {dateLabel(summary.lastReviewAt)}
                </p>
              )}
              <p className="constellation-as-of">
                As of {dateLabel(summary.asOf || data.generatedAt)}
                {data.checkpoint?.pending ? " · Updating evidence…" : ""}
                {loading ? " · Refreshing…" : ""}
              </p>
            </div>
            <div className="constellation-detail-links">
              <div className="constellation-connections">
                <span className="eyebrow">
                  <GitBranch size={12} />
                  Connected ideas
                </span>
                {currentEdges.length ? (
                  currentEdges.map((edge, i) => {
                    const id = edge.from === selected.id ? edge.to : edge.from;
                    const node = nodeById.get(id);
                    return (
                      <button key={`${id}-${i}`} onClick={() => go(id)}>
                        <span>
                          {plain(node?.label || "Connected concept")}
                          <small>
                            {relationLabel(edge)} ·{" "}
                            {edge.status === "suggested"
                              ? "Suggested"
                              : "Explicit link"}
                          </small>
                        </span>
                        <ArrowUpRight size={14} />
                      </button>
                    );
                  })
                ) : (
                  <p>No cross-connection recorded at this level.</p>
                )}
              </div>
              {noteRefs.length > 0 && (
                <div className="constellation-source-links">
                  <span className="eyebrow">Knowledge notes</span>
                  {noteRefs.map((note) => (
                    <button
                      key={`${note.sourceId}:${note.path || note.id}`}
                      onClick={() => onOpenNote(note)}
                    >
                      <FileText size={14} />
                      <span>
                        {plain(note.title || note.path || "Open note")}
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              )}
              {linkedCards.length > 0 && (
                <div className="constellation-source-links">
                  <span className="eyebrow">Practice cards</span>
                  {linkedCards.slice(0, 8).map((card) => (
                    <button key={card.id} onClick={() => onCard(card.id)}>
                      <BookOpen size={14} />
                      <span>
                        {plain(card.title)}
                        <small>
                          {formatNames[card.kind]}
                          {card.suspended ? " · Suspended" : ""}
                        </small>
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                  {linkedCards.length > 8 && (
                    <p>
                      {linkedCards.length - 8} more cards contribute to this
                      concept.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          <footer className="constellation-legend">
            <span>
              <DensityOrb summary={{ score: null }} small />
              Unassessed
            </span>
            <span>
              <DensityOrb
                summary={{ score: 8, total: 1, assessed: 1, needsPractice: 1 }}
                small
              />
              Needs practice
            </span>
            <span>
              <DensityOrb
                summary={{ score: 65, total: 1, assessed: 1 }}
                small
              />
              More evidence
            </span>
            <span>Density reflects expertise · Hollow does not mean weak</span>
          </footer>
        </>
      )}
    </section>
  );
}
