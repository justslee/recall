const { DatabaseSync } = require("node:sqlite");
const AdmZip = require("adm-zip");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const topicFor = (domain) =>
  ({
    "Japanese Monetary Policy": "Japanese Macro",
    "Trading Math": "Quantitative Finance",
    Finance: "Quantitative Finance",
    "Risk Management": "Quantitative Finance",
    "Advanced Python": "Programming",
    "Low-Latency Systems": "Programming",
    "AI Agent Development": "AI",
  })[domain] ||
  domain ||
  "Uncategorized";

function readAnki(filename) {
  if (fs.statSync(filename).size > 64 * 1024 * 1024)
    throw Error("Archive exceeds the initial 64 MB import limit.");
  const zip = new AdmZip(filename),
    entry = zip.getEntry("collection.anki2");
  if (!entry)
    throw Error(
      "This version supports collection.anki2 archives. Export a compatible Anki package.",
    );
  if (entry.header.size > 64 * 1024 * 1024)
    throw Error("Expanded collection exceeds import limit.");
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-import-"));
  let db;
  try {
    const database = path.join(folder, "collection.sqlite");
    const data = entry.getData();
    // The header's declared size is checked above; verify the real inflate too.
    if (data.length > 64 * 1024 * 1024)
      throw Error("Expanded collection exceeds import limit.");
    fs.writeFileSync(database, data);
    db = new DatabaseSync(database, { readOnly: true });
    const col = db.prepare("SELECT models,decks FROM col").get();
    const models = JSON.parse(col.models),
      decks = JSON.parse(col.decks);
    const rows = db
      .prepare(
        "SELECT c.*, n.guid,n.mid,n.flds,n.tags FROM cards c JOIN notes n ON n.id=c.nid",
      )
      .all();
    const digest = crypto
      .createHash("sha256")
      .update(fs.readFileSync(filename))
      .digest("hex");
    return rows.map((row) => {
      const fields = row.flds.split("\x1f"),
        names = models[row.mid]?.flds.map((f) => f.name) || [],
        get = (name) => fields[names.indexOf(name)] || "";
      const sourceDeck = decks[row.did]?.name || "Imported",
        domain = get("Domain") || sourceDeck.split("::").at(-1),
        reviewed = row.type !== 0 || row.queue !== 0;
      const supported =
        names.includes("Front") && names.includes("Back") && row.ord === 0;
      return {
        id: "anki-" + row.guid + "-" + row.ord,
        kind: "concept",
        title: get("Front") || fields[0] || "Imported card",
        prompt: "",
        answer: get("Back") || fields[1] || "",
        topic: topicFor(domain),
        tags: [domain, ...row.tags.trim().split(/\s+/).filter(Boolean)],
        decks: [path.basename(filename).replace(/\.[^.]+$/, "")],
        difficulty: "Foundation",
        status: reviewed || !supported ? "draft" : "ready",
        source: get("Source"),
        importWarning: reviewed
          ? "Original review state retained; scheduler migration required."
          : !supported
            ? "Unsupported template; inspect before publishing."
            : "",
        original: {
          archiveSha256: digest,
          sourceDeck,
          fields,
          noteId: row.nid,
          cardId: row.id,
          modelId: row.mid,
          type: row.type,
          queue: row.queue,
          due: row.due,
          interval: row.ivl,
          factor: row.factor,
          repetitions: row.reps,
          lapses: row.lapses,
        },
        conceptId: "anki-note-" + row.guid,
      };
    });
  } finally {
    db?.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
module.exports = { readAnki, topicFor };
