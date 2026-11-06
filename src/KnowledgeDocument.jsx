import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import renderMath from "katex/contrib/auto-render";
import { Diagram, SvgFigure } from "./RichContent";

// Preserve TeX before Markdown interprets backslashes or underscores.
const markdown = new Marked({
  gfm: true,
  extensions: [
    {
      name: "math",
      level: "inline",
      start: (text) => text.search(/\$|\\[([]/),
      tokenizer(text) {
        const match = text.match(
          /^(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?!\s)[^\n$]+?\$)/,
        );
        if (match) return { type: "math", raw: match[0], text: match[0] };
      },
      renderer: (token) =>
        token.text
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;"),
    },
  ],
});

export function KnowledgeDocument({ note, onLink }) {
  const ref = useRef();
  const [figures, setFigures] = useState([]);
  useEffect(() => {
    const root = ref.current;
    let live = true;
    const body =
      note.format === "html"
        ? note.body
        : note.body.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
    const html = note.format === "html" ? body : markdown.parse(body);
    const fragment = DOMPurify.sanitize(html, {
      RETURN_DOM_FRAGMENT: true,
      FORBID_TAGS: [
        "script",
        "style",
        "iframe",
        "object",
        "embed",
        "form",
        "input",
        "button",
        "textarea",
        "select",
        "link",
        "meta",
        "base",
        "video",
        "audio",
      ],
      FORBID_ATTR: ["style", "id", "name", "srcset"],
      ALLOW_DATA_ATTR: false,
    });
    const visuals = [];
    for (const element of fragment.querySelectorAll(
      "pre > code.language-mermaid, svg",
    )) {
      const host = document.createElement("div");
      const isSvg = element.tagName.toLowerCase() === "svg";
      visuals.push({
        host,
        svg: isSvg ? element.outerHTML : null,
        source: isSvg ? null : element.textContent,
      });
      (isSvg ? element : element.parentElement).replaceWith(host);
    }
    // Remove imported classes so source HTML cannot impersonate app controls.
    for (const element of fragment.querySelectorAll("[class]"))
      element.removeAttribute("class");
    for (const anchor of fragment.querySelectorAll("a")) {
      const value = anchor.getAttribute("href");
      anchor.removeAttribute("target");
      if (!value || /^(?:javascript|data|file|recall):/i.test(value))
        anchor.removeAttribute("href");
      else {
        anchor.href = "#";
        anchor.addEventListener("click", (e) => {
          e.preventDefault();
          onLink(value);
        });
      }
    }
    for (const image of fragment.querySelectorAll("img")) {
      const reference = image.getAttribute("src") || "";
      image.removeAttribute("src");
      image.loading = "lazy";
      if (
        /^data:image\/(?:png|jpeg|webp);base64,/.test(reference) &&
        reference.length < 16000000
      )
        image.src = reference;
      else if (reference && !/^(?:[a-z]+:|\/|#)/i.test(reference)) {
        window.recall
          .knowledgeAsset({
            sourceId: note.sourceId,
            path: note.path,
            reference,
          })
          .then((asset) => {
            if (live) image.src = asset.dataUri;
          })
          .catch(() => {
            if (live)
              image.replaceWith(
                document.createTextNode(
                  `[${image.alt || "Local image unavailable"}]`,
                ),
              );
          });
      } else
        image.replaceWith(
          document.createTextNode(
            `[${image.alt || "External image"} — not loaded]`,
          ),
        );
    }
    root.replaceChildren(fragment);
    // Wikilinks are converted only in text nodes, never inside code or markup attributes.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
      nodes = [];
    while (walker.nextNode())
      if (
        !walker.currentNode.parentElement.closest("pre,code,a") &&
        walker.currentNode.textContent.includes("[[")
      )
        nodes.push(walker.currentNode);
    for (const node of nodes) {
      const result = document.createDocumentFragment();
      let cursor = 0;
      for (const match of node.textContent.matchAll(
        /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      )) {
        result.append(node.textContent.slice(cursor, match.index));
        const a = document.createElement("a");
        a.href = "#";
        a.textContent = match[2] || match[1];
        a.addEventListener("click", (e) => {
          e.preventDefault();
          onLink(match[1]);
        });
        result.append(a);
        cursor = match.index + match[0].length;
      }
      result.append(node.textContent.slice(cursor));
      node.replaceWith(result);
    }
    renderMath(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
      trust: false,
      maxExpand: 1000,
    });
    setFigures(visuals);
    return () => {
      live = false;
    };
  }, [note.sourceId, note.path, note.body, note.format]);
  return (
    <>
      <div ref={ref} className="knowledge-prose" />
      {figures.map((f, i) =>
        createPortal(
          f.svg ? <SvgFigure markup={f.svg} /> : <Diagram source={f.source} />,
          f.host,
          String(i),
        ),
      )}
    </>
  );
}
