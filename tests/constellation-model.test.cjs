const { test } = require("node:test");
const assert = require("node:assert/strict");
const model = import("../src/constellation-model.js");

test("constellation zoom preserves the graph point beneath the gesture and has bounded magnification", async () => {
  const { anchoredZoom } = await model;
  const before = { scale: 1.25, x: -32, y: 17 };
  const anchor = { x: 284, y: 190 };
  const after = anchoredZoom(before, 2, anchor);
  assert.equal(
    (anchor.x - after.x) / after.scale,
    (anchor.x - before.x) / before.scale,
  );
  assert.equal(
    (anchor.y - after.y) / after.scale,
    (anchor.y - before.y) / before.scale,
  );
  assert.equal(anchoredZoom(before, 100, anchor).scale, 3.5);
  assert.equal(anchoredZoom(before, 0.001, anchor).scale, 0.03);
});

test("constellation never turns unknown evidence into zero or displays 100 expertise", async () => {
  const { expertiseSummary } = await model;
  assert.equal(expertiseSummary({ score: null }).score, null);
  assert.equal(expertiseSummary({ score: NaN }).score, null);
  assert.equal(expertiseSummary({ score: 99.99 }).score, 99.9);
  assert.equal(expertiseSummary({ score: 100 }).score, 99.9);
  assert.equal(expertiseSummary({ score: 0, assessed: 1, total: 2 }).score, 0);
  assert.equal(expertiseSummary({ coverage: 1.01 }).coverage, 1);
});

test("expertise display preserves tiny positive evidence without turning true zero into unknown", async () => {
  const { expertiseSummary, expertiseValue } = await model;
  const summary = expertiseSummary({ score: 0.00013, assessed: 1, total: 600 });
  assert.equal(summary.score, 0.00013);
  assert.equal(expertiseValue(summary.score), "<0.1");
  assert.equal(expertiseValue(0), "0.0");
  assert.equal(expertiseValue(null), "Unassessed");
  assert.equal(expertiseValue(NaN), "Unassessed");
  assert.equal(expertiseValue(0.1), "0.1");
  assert.equal(expertiseValue(99.99), "99.9");
});

test("domain hues follow primary ancestry while other roots retain independent context", async () => {
  const { graphLayout, expertiseSummary, domainColors } = await model;
  const node = (id, parentId, kind = "topic") => ({
    id,
    parentId,
    label: id,
    kind,
    summary: expertiseSummary(),
  });
  const data = {
    rootId: "root",
    focus: { id: "foreign-exchange" },
    nodes: [
      node("computing", "root"),
      node("mathematics-statistics", "root"),
      node("economics-finance", "root"),
      node("systems", "computing"),
      node("macroeconomics", "economics-finance"),
      node("foreign-exchange", "macroeconomics"),
      node("carry-trades", "foreign-exchange"),
      node("library:guides", null, "navigation"),
      node("guide", "library:guides", "concept"),
    ],
    // Related links do not reclassify another domain's concept.
    edges: [{ from: "carry-trades", to: "systems", type: "related" }],
  };
  const graph = graphLayout(data, 1200);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  assert.equal(graph.domains.length, 3);
  assert.equal(graph.activeDomain.id, "economics-finance");
  for (const id of [
    "economics-finance",
    "macroeconomics",
    "foreign-exchange",
    "carry-trades",
  ]) {
    assert.equal(byId.get(id).domain.id, "economics-finance");
    assert.equal(byId.get(id).context, "active");
  }
  for (const id of ["computing", "systems", "mathematics-statistics"])
    assert.equal(byId.get(id).context, "other");
  assert.equal(byId.get("systems").domain.id, "computing");
  assert.equal(byId.get("guide").domain, null);
  assert.equal(byId.get("guide").context, "neutral");
  assert.equal(new Set(graph.domains.map((d) => d.light)).size, 3);
  assert.equal(new Set(graph.domains.map((d) => d.dark)).size, 3);
  const overview = graphLayout({ ...data, focus: { id: "root" } }, 1200);
  assert.deepEqual(graph.domains, overview.domains);
  assert(
    overview.nodes
      .filter((n) => n.domain)
      .every((n) => n.context === "overview"),
  );
  assert.deepEqual(domainColors("custom-root"), domainColors("custom-root"));
  assert.notEqual(
    domainColors("custom-root").light,
    domainColors("custom-root").dark,
  );
});

test("constellation normalization retains connections and excludes dangling or duplicated nodes", async () => {
  const { normalizeGraph } = await model;
  const graph = normalizeGraph({
    rootId: "root",
    focus: { id: "storage", label: "Storage" },
    nodes: [
      { id: "storage" },
      { id: "columnar", parentId: "storage" },
      { id: "columnar", parentId: "storage" },
      { id: "arrow", parentId: "memory" },
    ],
    edges: [
      { from: "columnar", to: "arrow", type: "related", status: "suggested" },
      { from: "columnar", to: "absent", type: "related" },
    ],
  });
  assert.deepEqual(
    graph.nodes.map((n) => n.id),
    ["columnar", "arrow"],
  );
  assert(
    graph.edges.some(
      (e) =>
        e.from === "storage" && e.to === "columnar" && e.type === "hierarchy",
    ),
  );
  assert(graph.edges.some((e) => e.from === "columnar" && e.to === "arrow"));
  assert(!graph.edges.some((e) => e.to === "absent"));
  assert.equal(graph.ancestors[0].id, "root");
});

test("continuous world retains all branches and stable anchors while unfolding", async () => {
  const { graphLayout, expertiseSummary } = await model;
  const roots = Array.from({ length: 23 }, (_, i) => ({
    id: `root-${i}`,
    parentId: "root",
    label: `Domain ${i}`,
    summary: expertiseSummary(),
  }));
  const anchors = new Map();
  const before = graphLayout(
    { rootId: "root", focus: { id: "root" }, nodes: roots, edges: [] },
    1200,
    anchors,
  );
  const nodes = [
    ...roots,
    ...Array.from({ length: 1000 }, (_, i) => ({
      id: `leaf-${i}`,
      parentId: "root-0",
      summary: expertiseSummary(),
    })),
  ];
  const after = graphLayout(
    {
      rootId: "root",
      focus: { id: "root-0" },
      nodes,
      expandedIds: ["root-0"],
      edges: [],
    },
    1200,
    anchors,
  );
  assert.equal(after.nodes.length, 1023);
  for (const old of before.nodes) {
    const current = after.nodes.find((n) => n.id === old.id);
    assert.equal(current.x, old.x);
    assert.equal(current.y, old.y);
  }
  for (let i = 0; i < after.nodes.length; i++)
    for (let j = i + 1; j < after.nodes.length; j++) {
      const a = after.nodes[i],
        b = after.nodes[j];
      assert(
        Math.abs(a.x - b.x) >= 174 || Math.abs(a.y - b.y) >= 144,
        `Collision ${a.id}/${b.id}`,
      );
    }
});

test("fit includes the whole expanded world and viewport labels never discard underlying nodes", async () => {
  const { graphLayout, fitCamera, viewportNodes, expertiseSummary } =
    await model;
  const data = {
    rootId: "root",
    focus: { id: "root" },
    edges: [],
    nodes: [
      { id: "topic", parentId: "root", summary: expertiseSummary() },
      ...Array.from({ length: 1000 }, (_, i) => ({
        id: `leaf-${i}`,
        parentId: "topic",
        summary: expertiseSummary(),
      })),
    ],
  };
  const shape = graphLayout(data, 1200);
  const camera = fitCamera(shape, 1200, 680);
  for (const n of shape.nodes) {
    assert(
      n.x * camera.scale + camera.x >= 0 &&
        n.x * camera.scale + camera.x <= 1200,
    );
    assert(
      n.y * camera.scale + camera.y >= 0 &&
        n.y * camera.scale + camera.y <= 680,
    );
  }
  assert(viewportNodes(shape, camera, 1200, 680).length < 100);
  const last = shape.nodes.at(-1);
  assert(
    viewportNodes(
      shape,
      { scale: 1, x: 600 - last.x, y: 340 - last.y },
      1200,
      680,
    ).some((n) => n.id === last.id),
  );
  assert.equal(shape.nodes.length, 1001);
});

test("relationship labels avoid node targets and each other or remain hidden", async () => {
  const { curve, placeEdgeLabels } = await model;
  const nodes = [
    { x: 150, y: 150, width: 150, height: 137 },
    { x: 650, y: 350, width: 150, height: 137 },
  ];
  const edges = Array.from({ length: 4 }, () => ({
    type: "related",
    labelWidth: 90,
    curve: curve(nodes[0], nodes[1]),
  }));
  const positions = placeEdgeLabels(edges, nodes, 800, 520).filter(Boolean);
  assert(positions.length > 0);
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      assert(
        Math.abs(positions[i].x - positions[j].x) >= 102 ||
          Math.abs(positions[i].y - positions[j].y) >= 20,
      );
    }
  }
});
