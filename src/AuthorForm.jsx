import React, { useState } from "react";
import { plain, formatLabel } from "./model";
import { RichContent } from "./RichContent";

const widgetTemplate = `
\`\`\`widget Explore the mechanism
<label>Input <b id="v">50</b><input id="x" type="range" min="0" max="100" value="50"></label>
<div class="grid">
  <div class="metric"><small>Result</small><strong id="out"></strong></div>
</div>
<script>
const x = document.getElementById("x");
const draw = () => {
  document.getElementById("v").textContent = x.value;
  document.getElementById("out").textContent = (x.value * 2).toFixed(0);
};
x.oninput = draw;
draw();
</script>
\`\`\`
`;
const svgTemplate = `
<svg viewBox="0 0 320 120" role="img" aria-label="Describe the figure">
  <style>.lbl{font:13px var(--sans);fill:var(--muted)}</style>
  <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="var(--accent)"/></marker></defs>
  <rect x="10" y="30" width="120" height="60" rx="10" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
  <text x="70" y="65" text-anchor="middle" fill="var(--text)">Cause</text>
  <path d="M135 60 H182" stroke="var(--accent)" stroke-width="2" marker-end="url(#arrow)"/>
  <rect x="190" y="30" width="120" height="60" rx="10" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
  <text x="250" y="65" text-anchor="middle" fill="var(--text)">Effect</text>
  <text x="160" y="112" text-anchor="middle" class="lbl">Static figure · CSS variables pick up the theme</text>
</svg>
`;

export function AuthorForm({
  card,
  decks,
  defaultDeck,
  topics,
  defaultTopic,
  onSave,
  onCancel,
}) {
  const [form, setForm] = useState(
    card
      ? {
          ...card,
          title: plain(card.title),
          widgetsAllowed: card.widgetsAllowed === true,
        }
      : {
          title: "",
          prompt: "",
          answer: "",
          topic: defaultTopic || "Programming",
          decks: [defaultDeck],
          tags: [],
          difficulty: "Foundation",
          kind: "concept",
          status: "draft",
          widgetsAllowed: true,
        },
  );
  const change = (key, value) => setForm({ ...form, [key]: value });
  const locked = !!card && card.kind !== "concept";
  return (
    <div className="author-layout">
      <form
        className="author"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(form);
        }}
      >
        <div className="author-grid">
          <label>
            Deck
            <select
              value={form.decks[0]}
              onChange={(e) => change("decks", [e.target.value])}
            >
              {decks.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            Broad topic
            <input
              required
              list="topics"
              value={form.topic}
              onChange={(e) => change("topic", e.target.value)}
            />
            <datalist id="topics">
              {topics.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </datalist>
          </label>
          <label>
            Difficulty
            <select
              value={form.difficulty}
              onChange={(e) => change("difficulty", e.target.value)}
            >
              {["Foundation", "Application", "Challenge"].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(e) => change("status", e.target.value)}
            >
              <option value="draft">Draft · excluded from review</option>
              <option value="ready">Ready to study</option>
            </select>
          </label>
        </div>
        <label>
          Question
          <input
            required
            autoFocus={!card}
            value={form.title}
            readOnly={locked}
            placeholder="What do you want to be able to recall?"
            onChange={(e) => change("title", e.target.value)}
          />
        </label>
        <label>
          Prompt / context
          <textarea
            rows="2"
            value={form.prompt}
            readOnly={locked}
            placeholder="Optional framing shown under the question"
            onChange={(e) => change("prompt", e.target.value)}
          />
        </label>
        <label>
          Answer (HTML and LaTeX supported)
          <textarea
            required
            rows="9"
            value={form.answer}
            readOnly={locked}
            placeholder={
              '<p>Write the answer.</p>\n\\[ e^{i\\pi} + 1 = 0 \\]\n```mermaid\nflowchart LR\n  A[Cause] --> B[Effect]\n```\n<svg viewBox="0 0 100 40">…</svg>\n```widget Explore the mechanism\n<label>…</label><script>…</script>\n```'
            }
            onChange={(e) => change("answer", e.target.value)}
          />
        </label>
        {!locked && (
          <div className="field-actions">
            <button
              type="button"
              className="text-button"
              onClick={() => change("answer", form.answer + widgetTemplate)}
            >
              Insert widget template
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => change("answer", form.answer + svgTemplate)}
            >
              Insert SVG figure template
            </button>
          </div>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={form.widgetsAllowed}
            onChange={(e) => change("widgetsAllowed", e.target.checked)}
          />
          Allow this card’s interactive widgets to run (sandboxed, and only when
          you click Load)
        </label>
        <label>
          Narrow tags (comma-separated)
          <input
            value={form.tags.join(", ")}
            placeholder="carry-trades, BOJ-policy"
            onChange={(e) =>
              change(
                "tags",
                e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
        <p className="muted">
          {locked
            ? "You can change this card’s organization here. Specialist content editing, including matching tests and numerical criteria, is coming in the next milestone."
            : card
              ? `Editing a ${formatLabel[card.kind].toLowerCase()} card preserves its review history and specialist workspace.`
              : "This editor creates concept cards. Math and coding study are active; their richer authoring forms are the next milestone."}
        </p>
        <div className="form-actions">
          <button className="primary" type="submit">
            Save card
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
      <aside className="preview-pane" aria-label="Answer preview">
        <span className="eyebrow">Live preview</span>
        <h2>{form.title || "Your question"}</h2>
        {form.prompt && <p className="question-prompt">{form.prompt}</p>}
        {form.answer.trim() ? (
          <RichContent html={form.answer} />
        ) : (
          <p className="placeholder">
            The rendered answer appears here as you type.
          </p>
        )}
      </aside>
    </div>
  );
}

export function NewDeck({ onSave, onCancel }) {
  const [name, setName] = useState("");
  return (
    <form
      className="author"
      style={{ maxWidth: 560 }}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(name);
      }}
    >
      <p className="muted">
        A deck collects material for a purpose. Topics describe the broad
        subjects inside it, and a card can belong to more than one deck without
        losing its review history.
      </p>
      <label>
        Deck name
        <input
          required
          autoFocus
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Quant interview prep"
        />
      </label>
      <div className="form-actions">
        <button className="primary" type="submit">
          Create deck
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
