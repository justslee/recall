export const PAGE_SIZE = 200;
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function expertiseSummary(value = {}) {
  const total = Math.max(0, Number(value.total) || 0);
  const assessed = clamp(Number(value.assessed) || 0, 0, total);
  return {
    ...value,
    total,
    assessed,
    score:
      value.score == null || !Number.isFinite(Number(value.score))
        ? null
        : clamp(Number(value.score), 0, 99.9),
    coverage: clamp(Number(value.coverage) || 0, 0, 1),
    confidence: clamp(Number(value.confidence) || 0, 0, 1),
    needsPractice: Math.max(0, Number(value.needsPractice) || 0),
    reviewCount: Math.max(0, Number(value.reviewCount) || 0),
  };
}

export function expertiseValue(value) {
  if (value == null || !Number.isFinite(Number(value))) return "Unassessed";
  const score = clamp(Number(value), 0, 99.9);
  return score > 0 && score < 0.1
    ? "<0.1"
    : (Math.floor(score * 10) / 10).toFixed(1);
}

// Hue describes subject identity, never mastery. A stable primary parent path
// keeps a topic's color unchanged as neighboring branches open or close.
const DOMAIN_COLORS = {
  computing: { light: "#356ba6", dark: "#8bb9ef" },
  "mathematics-statistics": { light: "#8053a2", dark: "#c7a4ee" },
  "economics-finance": { light: "#267d70", dark: "#80cfb9" },
};
export function domainColors(id) {
  if (DOMAIN_COLORS[id]) return DOMAIN_COLORS[id];
  let hash = 0;
  for (const character of id || "")
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return {
    light: `hsl(${hue} 42% 37%)`,
    dark: `hsl(${hue} 55% 73%)`,
  };
}

export function graphDomains(data) {
  const rootId = data.rootId || "root";
  const all = new Map((data.nodes || []).map((n) => [n.id, n]));
  if (data.focus)
    all.set(data.focus.id, { ...all.get(data.focus.id), ...data.focus });
  const domains = new Map();
  for (const node of all.values())
    if (
      node.parentId === rootId &&
      !["holding", "navigation"].includes(node.kind)
    )
      domains.set(node.id, {
        id: node.id,
        label: node.label || node.id,
        ...domainColors(node.id),
      });
  const membership = new Map();
  function domainFor(id) {
    if (membership.has(id)) return membership.get(id);
    const trail = [],
      seen = new Set();
    let current = id,
      result = null;
    while (current && !seen.has(current)) {
      seen.add(current);
      trail.push(current);
      if (domains.has(current)) {
        result = domains.get(current);
        break;
      }
      if (membership.has(current)) {
        result = membership.get(current);
        break;
      }
      current = all.get(current)?.parentId;
    }
    for (const ancestor of trail) membership.set(ancestor, result);
    return result;
  }
  for (const node of all.values()) domainFor(node.id);
  const canonicalOrder = Object.keys(DOMAIN_COLORS);
  const ordered = [...domains.values()].sort((a, b) => {
    const rank = (id) => {
      const index = canonicalOrder.indexOf(id);
      return index < 0 ? canonicalOrder.length : index;
    };
    return (
      rank(a.id) - rank(b.id) ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id)
    );
  });
  return {
    domains: ordered,
    membership,
    active: domainFor(data.focus.id),
  };
}

export function normalizeGraph(data) {
  const rootId = data?.rootId || "root";
  const focus = data?.focus || { id: rootId, label: "All knowledge" };
  const unique = new Map();
  for (const node of data?.nodes || []) {
    if (node?.id && node.id !== focus.id)
      unique.set(node.id, { ...node, summary: expertiseSummary(node.summary) });
  }
  const nodes = [...unique.values()];
  const ids = new Set([focus.id, ...unique.keys()]);
  const edges = new Map();
  for (const edge of data?.edges || []) {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to)
      continue;
    edges.set([edge.from, edge.to, edge.type].join("\0"), edge);
  }
  if (focus.id !== rootId) {
    for (const node of nodes) {
      if (node.parentId !== focus.id) continue;
      const edge = {
        from: focus.id,
        to: node.id,
        type: "hierarchy",
        status: "explicit",
      };
      edges.set([edge.from, edge.to, edge.type].join("\0"), edge);
    }
  }
  const ancestors = (data?.ancestors || []).filter((n) => n?.id !== focus.id);
  if (!ancestors.some((n) => n.id === rootId) && focus.id !== rootId)
    ancestors.unshift({ id: rootId, label: "All knowledge" });
  return {
    ...data,
    rootId,
    focus: { ...focus, summary: expertiseSummary(focus.summary) },
    ancestors,
    nodes,
    edges: [...edges.values()],
  };
}

// A stable world, separate from the viewport. Existing nodes keep their anchors
// when a neighboring branch unfolds; a spatial hash places new nodes in free cells.
export function graphLayout(data, width, anchors = new Map()) {
  const height = width < 740 ? 620 : 680;
  const rootId = data.rootId || "root";
  const all = data.nodes.filter((n) => n.id !== rootId);
  const domains = graphDomains(data);
  const roots = all.filter((n) => n.parentId === rootId);
  const occupied = new Map();
  const cell = (x, y) => `${Math.floor(x / 180)}:${Math.floor(y / 150)}`;
  const reserve = (p) => {
    const key = cell(p.x, p.y);
    if (!occupied.has(key)) occupied.set(key, []);
    occupied.get(key).push(p);
  };
  const free = (p) => {
    const x = Math.floor(p.x / 180),
      y = Math.floor(p.y / 150);
    for (let i = x - 1; i <= x + 1; i++)
      for (let j = y - 1; j <= y + 1; j++)
        for (const other of occupied.get(`${i}:${j}`) || [])
          if (Math.abs(other.x - p.x) < 175 && Math.abs(other.y - p.y) < 145)
            return false;
    return true;
  };
  for (const n of all) {
    const position = anchors.get(n.id);
    if (!position) continue;
    if (free(position)) reserve(position);
    else anchors.delete(n.id);
  }
  const rootWidth = Math.max(900, width),
    cols = Math.min(5, Math.max(1, roots.length));
  roots.forEach((n, i) => {
    if (anchors.has(n.id)) return;
    const p =
      roots.length === 3
        ? { x: rootWidth * [0.23, 0.5, 0.77][i], y: [340, 140, 340][i] }
        : {
            x: (rootWidth * ((i % cols) + 0.5)) / cols,
            y: 140 + Math.floor(i / cols) * 170,
          };
    anchors.set(n.id, p);
    reserve(p);
  });
  const cursors = new Map();
  for (const n of all) {
    if (anchors.has(n.id)) continue;
    const parent = anchors.get(n.parentId) || { x: rootWidth / 2, y: 240 };
    let direction = 0;
    for (const character of n.parentId || n.id)
      direction = (direction * 31 + character.charCodeAt(0)) >>> 0;
    let k = cursors.get(n.parentId) || 0,
      p;
    do {
      const angle = ((direction % 360) * Math.PI) / 180 + k * 2.399963;
      const radius = 200 * Math.sqrt(1 + k * 0.38);
      p = {
        x: parent.x + Math.cos(angle) * radius,
        y: parent.y + Math.sin(angle) * radius * 0.78,
      };
      k++;
    } while (!free(p));
    cursors.set(n.parentId, k);
    anchors.set(n.id, p);
    reserve(p);
  }
  const expanded = new Set(data.expandedIds || []);
  const nodes = all.map((n) => ({
    ...n,
    domain: domains.membership.get(n.id),
    context: !domains.membership.get(n.id)
      ? "neutral"
      : !domains.active
        ? "overview"
        : domains.membership.get(n.id).id === domains.active.id
          ? "active"
          : "other",
    ...anchors.get(n.id),
    role:
      n.id === data.focus.id
        ? "focus"
        : n.parentId === rootId
          ? "root"
          : "child",
    expanded: expanded.has(n.id),
  }));
  const ids = new Set(nodes.map((n) => n.id));
  return {
    width,
    height,
    compact: width < 740,
    nodes,
    domains: domains.domains,
    activeDomain: domains.active,
    edges: data.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
  };
}

export function fitCamera(shape, width, height, selectedIds) {
  const nodes = selectedIds
    ? shape.nodes.filter((n) => selectedIds.has(n.id))
    : shape.nodes;
  if (!nodes.length) return { scale: 1, x: 0, y: 0 };
  const minX = Math.min(...nodes.map((n) => n.x)) - 110;
  const maxX = Math.max(...nodes.map((n) => n.x)) + 110;
  const minY = Math.min(...nodes.map((n) => n.y)) - 85;
  const maxY = Math.max(...nodes.map((n) => n.y)) + 110;
  const scale = Math.max(
    0.03,
    Math.min(1, (width - 40) / (maxX - minX), (height - 70) / (maxY - minY)),
  );
  return {
    scale,
    x: width / 2 - ((minX + maxX) / 2) * scale,
    y: height / 2 - ((minY + maxY) / 2) * scale,
  };
}

export function viewportNodes(shape, camera, width, height) {
  // All nodes stay in the canvas. Only full labels/accessible DOM targets are
  // windowed; a searchable selector and canvas hit-testing reach overview dots.
  return shape.nodes.filter((n) => {
    const x = n.x * camera.scale + camera.x,
      y = n.y * camera.scale + camera.y;
    return (
      x > -100 &&
      x < width + 100 &&
      y > -100 &&
      y < height + 100 &&
      (camera.scale >= 0.55 || n.role === "focus")
    );
  });
}

export function anchoredZoom(camera, scale, anchor) {
  const next = clamp(scale, 0.03, 3.5);
  const ratio = next / camera.scale;
  return {
    scale: next,
    x: anchor.x - (anchor.x - camera.x) * ratio,
    y: anchor.y - (anchor.y - camera.y) * ratio,
  };
}

export function curve(a, b) {
  const cx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08;
  const cy = (a.y + b.y) / 2 - (b.x - a.x) * 0.08;
  return {
    d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`,
    point(t, offset = 0) {
      const p = 1 - t;
      const dx = 2 * p * (cx - a.x) + 2 * t * (b.x - cx);
      const dy = 2 * p * (cy - a.y) + 2 * t * (b.y - cy);
      const length = Math.hypot(dx, dy) || 1;
      return {
        x: p * p * a.x + 2 * p * t * cx + t * t * b.x - (dy / length) * offset,
        y: p * p * a.y + 2 * p * t * cy + t * t * b.y + (dx / length) * offset,
      };
    },
  };
}

export function placeEdgeLabels(edges, nodes, width, height) {
  const used = [];
  const overlaps = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const blocked = nodes.map((n) => ({
    x: n.x - n.width / 2 - 5,
    y: n.y - 48,
    w: n.width + 10,
    h: n.height + 10,
  }));
  return edges.map((edge) => {
    if (edge.type === "hierarchy") return null;
    for (const t of [0.5, 0.38, 0.62]) {
      for (const offset of [0, 20, -20, 32, -32]) {
        const p = edge.curve.point(t, offset);
        const y = p.y - 7;
        const rect = {
          x: p.x - edge.labelWidth / 2 - 6,
          y: y - 13,
          w: edge.labelWidth + 12,
          h: 20,
        };
        if (
          rect.x < 10 ||
          rect.x + rect.w > width - 10 ||
          rect.y < 35 ||
          rect.y + rect.h > height - 10
        )
          continue;
        if ([...blocked, ...used].some((b) => overlaps(rect, b))) continue;
        used.push(rect);
        return { x: p.x, y };
      }
    }
    return null;
  });
}
