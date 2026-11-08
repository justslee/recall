// A deliberately narrow, non-executing authoring gate. The renderer still applies
// its SVG-profile sanitizer and strict Mermaid configuration before display.
// This module never fetches resources, loads a DOM, renders, or executes content.
const TAGS = new Set([
  "svg",
  "g",
  "rect",
  "circle",
  "ellipse",
  "line",
  "path",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "title",
  "desc",
  "defs",
  "marker",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "style",
]);
const ATTRS = new Set([
  "xmlns",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "dx",
  "dy",
  "id",
  "class",
  "role",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "fill",
  "stroke",
  "color",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "stroke-width",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "fill-rule",
  "clip-rule",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  "textLength",
  "lengthAdjust",
  "preserveAspectRatio",
  "transform",
  "vector-effect",
  "paint-order",
  "marker-start",
  "marker-mid",
  "marker-end",
  "markerWidth",
  "markerHeight",
  "markerUnits",
  "refX",
  "refY",
  "orient",
  "clip-path",
  "clipPathUnits",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "offset",
  "stop-color",
  "stop-opacity",
  "fx",
  "fy",
  "fr",
  "style",
]);
const PRESENTATION = new Set([
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "fill-rule",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "color",
  "font",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  "vector-effect",
  "paint-order",
  "marker-start",
  "marker-mid",
  "marker-end",
  "clip-path",
  "stop-color",
  "stop-opacity",
]);
const LOCAL_REFERENCE = new Set([
  "fill",
  "stroke",
  "marker-start",
  "marker-mid",
  "marker-end",
  "clip-path",
]);
function entities(value) {
  return value.replace(/&([^;\s]+);/g, (whole, entity) => {
    const named = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    };
    if (Object.hasOwn(named, entity)) return named[entity];

    const number = /^#x[\da-f]+$/i.test(entity)
      ? parseInt(entity.slice(2), 16)
      : /^#\d+$/.test(entity)
        ? Number(entity.slice(1))
        : NaN;
    if (
      !Number.isSafeInteger(number) ||
      number <= 0 ||
      number > 0x10ffff ||
      (number >= 0xd800 && number <= 0xdfff)
    )
      throw Error("Unsupported static figure entity");

    return String.fromCodePoint(number);
  });
}
function safeValue(property, value) {
  const decoded = entities(value);
  if (
    /[\\<>@\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(decoded) ||
    /(?:https?|javascript|data|file|vbscript)\s*:|\/\/|expression\s*\(/i.test(
      decoded,
    )
  )
    throw Error("Static figures cannot include executable or network values");

  if (
    /url\s*\(/i.test(decoded) &&
    !(
      LOCAL_REFERENCE.has(property) &&
      /^url\(\s*#[A-Za-z_][\w.-]*\s*\)$/i.test(decoded)
    )
  )
    throw Error("Static figure URLs must be local fragment references");
}
function declarations(source) {
  const result = [];
  if (/[{}]|\/\*|\*\//.test(source))
    throw Error("Unsupported static figure CSS declaration");

  for (const declaration of source.split(";")) {
    if (!declaration.trim()) continue;

    const match = /^\s*([\w-]+)\s*:\s*(\S[\s\S]*?)\s*$/.exec(declaration);
    if (
      !match ||
      !(PRESENTATION.has(match[1]) || /^--[A-Za-z][\w-]*$/.test(match[1]))
    )
      throw Error("Static figure CSS is limited to presentation properties");

    safeValue(match[1], match[2]);
    if (/!\s*important/i.test(match[2]))
      throw Error("Static figure CSS cannot override with !important");
    result.push([match[1], match[2]]);
  }
  return result;
}
function stylesheet(source, nested = false) {
  const result = [];
  if (/[\\<>]|\/\*|\*\//.test(source))
    throw Error("Unsupported static figure stylesheet");

  let cursor = 0;
  while (cursor < source.length) {
    if (!source.slice(cursor).trim()) break;

    const opening = source.indexOf("{", cursor);
    if (opening < 0) throw Error("Incomplete static figure CSS rule");

    const selector = source.slice(cursor, opening).trim();
    let depth = 1,
      end = opening + 1;
    while (end < source.length && depth) {
      if (source[end] === "{") depth++;
      if (source[end] === "}") depth--;
      end++;
    }
    if (depth) throw Error("Unbalanced static figure CSS");

    const body = source.slice(opening + 1, end - 1);
    if (
      /^@media\s*\(\s*prefers-color-scheme\s*:\s*(?:dark|light)\s*\)$/i.test(
        selector,
      )
    ) {
      if (nested)
        throw Error("Nested static figure media rules are unsupported");

      result.push([selector, stylesheet(body, true)]);
    } else {
      // Selectors only affect the isolated SVG image. No at-rules, imports,
      // escapes, attributes, pseudo-functions, or external-resource selectors.
      if (!/^[A-Za-z0-9_#.\s,>*+-]+$/.test(selector))
        throw Error("Unsupported static figure CSS selector");

      result.push([selector, declarations(body)]);
    }
    cursor = end;
  }
  return result;
}
function tagAt(source, start) {
  let quote = null;
  for (let end = start + 1; end < source.length; end++) {
    const ch = source[end];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">")
      return { raw: source.slice(start, end + 1), end: end + 1 };
  }
  throw Error("Unterminated static figure tag");
}
function validateSvg(source) {
  if (/<!|<\?|```|~~~/.test(source))
    throw Error(
      "Static SVG cannot contain declarations, comments, or code fences",
    );

  const stack = [];
  let cursor = 0,
    roots = 0;
  while (cursor < source.length) {
    if (source[cursor] !== "<") {
      const next = source.indexOf("<", cursor),
        end = next < 0 ? source.length : next;
      const text = source.slice(cursor, end),
        parent = stack.at(-1);
      if (parent === "style") stylesheet(text);
      else {
        entities(text);
        if (text.trim() && !["text", "tspan", "title", "desc"].includes(parent))
          throw Error("Static SVG text must belong to a text element");
      }
      cursor = end;
      continue;
    }
    const token = tagAt(source, cursor),
      match = /^<(\/?)([A-Za-z][\w:-]*)([\s\S]*?)(\/?)>$/.exec(token.raw);
    if (!match || !TAGS.has(match[2]))
      throw Error("Unsupported static SVG element");

    const [, closing, name, tail, selfClosing] = match;
    if (closing) {
      if (tail.trim() || selfClosing || stack.pop() !== name)
        throw Error("Unbalanced static SVG elements");
    } else {
      if (!stack.length) {
        if (name !== "svg" || roots++)
          throw Error("Expected exactly one static SVG root");
      } else if (name === "svg" || stack.at(-1) === "style") {
        throw Error("Nested SVG roots and markup in CSS are unsupported");
      }
      const seen = new Set();
      let rest = tail;
      while (rest.trim()) {
        const attr = /^\s+([A-Za-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(
          rest,
        );
        if (!attr || !ATTRS.has(attr[1]) || seen.has(attr[1]))
          throw Error("Unsupported or duplicate static SVG attribute");

        const key = attr[1],
          value = attr[2] ?? attr[3];
        if (key === "xmlns") {
          if (name !== "svg" || value !== "http://www.w3.org/2000/svg")
            throw Error("Unsupported SVG namespace");
        } else if (key === "style") declarations(entities(value));
        else safeValue(key, value);
        seen.add(key);
        rest = rest.slice(attr[0].length);
      }
      if (!selfClosing) stack.push(name);
    }
    cursor = token.end;
  }
  if (stack.length || roots !== 1) throw Error("Unbalanced static SVG root");
}
function validateMermaid(source) {
  const decoded = entities(source);
  if (
    /```|~~~|%%\s*\{|^\s*---|@\s*\{|<\/?[A-Za-z][^>]*>|[\\\u0000-\u0008\u000b\u000c\u000e-\u001f]/m.test(
      decoded,
    ) ||
    /(?:https?|javascript|data|file|vbscript)\s*:|url\s*\(|@import|securityLevel|themeCSS|htmlLabels/i.test(
      decoded,
    ) ||
    /(?:^|[;\n])\s*(?:click|link|links|callback)\b/i.test(decoded)
  )
    throw Error(
      "Mermaid revisions cannot add configuration, HTML, scripts, links or network resources",
    );
}
function validateFigureSource(kind, source) {
  if (
    !["svg", "mermaid"].includes(kind) ||
    typeof source !== "string" ||
    !source.trim() ||
    Buffer.byteLength(source) > 500_000
  )
    throw Error("Invalid or oversized static figure source");

  if (kind === "svg") validateSvg(source);
  else validateMermaid(source);
  return source;
}
// Styling is ignored only for this explicitly requested revision proof. The
// library-wide objective hash and ordinary semantic-edit invalidation stay intact.
// Marker/clip references, geometry, alignment, IDs, text and node order remain.
const APPEARANCE = new Set([
  "fill",
  "stroke",
  "color",
  "stroke-width",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "font",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "letter-spacing",
  "paint-order",
  "stop-color",
]);
const appearance = (key) => APPEARANCE.has(key) || key.startsWith("--");
function assertFixedStructure(value) {
  if (/\b(?:var|env)\s*\(/i.test(value))
    throw Error(
      "Structural SVG values cannot depend on presentation variables",
    );
}
function structuralRules(rules) {
  return rules.flatMap(([selector, body]) => {
    const retained = selector.startsWith("@")
      ? structuralRules(body)
      : body.filter(([property]) => !appearance(property));
    if (!selector.startsWith("@"))
      for (const [, value] of retained) assertFixedStructure(value);
    return retained.length ? [[selector, retained]] : [];
  });
}
function svgStructure(source) {
  const css = [
    ...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/g),
  ].flatMap((match) => structuralRules(stylesheet(match[1])));
  const events = [],
    stack = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (source[cursor] !== "<") {
      const next = source.indexOf("<", cursor);
      const end = next < 0 ? source.length : next;
      // Whitespace inside a label is content; indentation between shapes is not.
      if (["text", "tspan", "title", "desc"].includes(stack.at(-1)))
        events.push(["text", entities(source.slice(cursor, end))]);
      cursor = end;
      continue;
    }
    const token = tagAt(source, cursor);
    const [, closing, name, tail, selfClosing] =
      /^<(\/?)([A-Za-z][\w:-]*)([\s\S]*?)(\/?)>$/.exec(token.raw);
    if (name === "style") {
      cursor = selfClosing ? token.end : source.indexOf("</style", token.end);
      if (!selfClosing) cursor = tagAt(source, cursor).end;
      continue;
    }
    if (closing) {
      stack.pop();
      events.push(["close", name]);
    } else {
      const attrs = [];
      for (const attr of tail.matchAll(
        /\s+([A-Za-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
      )) {
        const key = attr[1],
          value = entities(attr[2] ?? attr[3]);
        if (key === "style") {
          const retained = declarations(value).filter(
            ([property]) => !appearance(property),
          );
          for (const [, value] of retained) assertFixedStructure(value);
          if (retained.length) attrs.push([key, retained]);
        } else if (!appearance(key) && (key !== "class" || css.length)) {
          assertFixedStructure(value);
          attrs.push([key, value]);
        }
      }
      attrs.sort(([a], [b]) => a.localeCompare(b));
      events.push(["open", name, attrs]);
      if (selfClosing) events.push(["close", name]);
      else stack.push(name);
    }
    cursor = token.end;
  }
  return JSON.stringify({ events, css });
}
function mermaidStructure(source, knownNodes = null) {
  const lines = [];
  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*classDef\b/.test(line)) {
      const match = /^\s*classDef\s+[A-Za-z_][\w-]*\s+([^;]+);?\s*$/.exec(line);
      if (!match)
        throw Error("Unsupported Mermaid presentation class definition");
      for (const declaration of match[1].split(",")) {
        const pair = /^\s*([\w-]+)\s*:\s*(\S.*?)\s*$/.exec(declaration);
        if (!pair || !APPEARANCE.has(pair[1]))
          throw Error(
            "Mermaid class definitions must contain only appearance properties",
          );
        safeValue(pair[1], pair[2]);
      }
    } else if (/^\s*class\b/.test(line)) {
      const match =
        /^\s*class\s+([A-Za-z_][\w-]*(?:\s*,\s*[A-Za-z_][\w-]*)*)\s+[A-Za-z_][\w-]*;?\s*$/.exec(
          line,
        );
      if (!match)
        throw Error("Unsupported Mermaid presentation class assignment");
      if (
        knownNodes &&
        match[1].split(",").some((id) => !knownNodes.has(id.trim()))
      )
        throw Error(
          "Mermaid presentation classes cannot introduce unknown nodes",
        );
    } else if (line.trim()) {
      lines.push(line.trimEnd());
    }
  }
  return JSON.stringify(lines);
}
function mermaidKnownNodes(source) {
  const lines = JSON.parse(mermaidStructure(source));
  if (
    !/^\s*(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\s*;?\s*$/.test(
      lines.shift() || "",
    )
  )
    throw Error("Presentation proof supports only ordinary Mermaid flowcharts");
  const node = String.raw`([A-Za-z_]\w*)(?:\[(?:"[^"\r\n]*"|[^\]"\r\n]+)\])?`;
  const edge = String.raw`(?:-->|---|-\.->|-\.\s*"[^"\r\n]*"\s*\.->)`;
  const statement = new RegExp(
    String.raw`^\s*${node}(?:\s*${edge}\s*${node})?\s*;?\s*$`,
  );
  const nodes = new Set();
  for (const line of lines) {
    const match = statement.exec(line);
    if (!match)
      throw Error("Unsupported Mermaid topology for presentation proof");
    nodes.add(match[1]);
    if (match[2]) nodes.add(match[2]);
  }
  return nodes;
}
function assertPresentationOnly(kind, before, after) {
  validateFigureSource(kind, before);
  validateFigureSource(kind, after);
  const knownNodes = kind === "mermaid" ? mermaidKnownNodes(before) : null;
  const structure =
    kind === "svg"
      ? svgStructure
      : (source) => mermaidStructure(source, knownNodes);
  if (structure(before) !== structure(after))
    throw Error(
      "Static figure revision must preserve all text, geometry and topology; presentation changes only",
    );
}
function figureSource(answer, figure) {
  const source = answer.slice(figure.sourceStart, figure.sourceEnd);
  return figure.wrapper === "pre" ? entities(source) : source;
}
function closingElement(source, start, name) {
  let depth = 0,
    cursor = start;
  while (cursor < source.length) {
    const at = source.indexOf("<", cursor);
    if (at < 0) break;
    if (source.startsWith("<!--", at)) {
      const end = source.indexOf("-->", at + 4);
      if (end < 0) break;
      cursor = end + 3;
      continue;
    }
    const tag = tagAt(source, at),
      match = /^<(\/?)([\w:-]+)\b[\s\S]*?(\/?)>$/.exec(tag.raw);
    if (match?.[2].toLowerCase() === name) {
      if (match[1]) depth--;
      else if (!match[3]) depth++;
      if (depth === 0) return { start: at, end: tag.end };
    }
    cursor = tag.end;
  }
  throw Error("Unterminated static figure or code element");
}
function figuresOf(answer) {
  if (typeof answer !== "string") throw Error("Expected an answer string");

  const figures = [];
  // One lexical walk owns outer blocks first. Figure-like text in an HTML
  // attribute, a widget, another code fence, or an inline code span is data.
  const tokens =
    /^ {0,3}(?<fence>`{3,}|~{3,})(?<info>[^\r\n]*)\r?\n|(?<comment><!--)|(?<tag><\/?[A-Za-z][\w:-]*\b)|(?<inline>`+)/gim;
  let match;
  while ((match = tokens.exec(answer))) {
    const start = match.index,
      groups = match.groups;
    if (groups.fence) {
      const marker = groups.fence[0],
        length = groups.fence.length;
      const closes = /^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r?\n|$)/gm;
      closes.lastIndex = tokens.lastIndex;
      let close;
      while (
        (close = closes.exec(answer)) &&
        (close[1][0] !== marker || close[1].length < length)
      ) {}
      if (!close) break; // An unclosed code block owns the rest of the answer.

      if (groups.info.trim().toLowerCase() === "mermaid") {
        const sourceStart = tokens.lastIndex;
        const eol = answer.slice(0, close.index).endsWith("\r\n")
          ? "\r\n"
          : "\n";
        const sourceEnd =
          close.index > sourceStart ? close.index - eol.length : close.index;
        figures.push({
          kind: "mermaid",
          start,
          end: closes.lastIndex,
          sourceStart,
          sourceEnd,
          wrapper: "fence",
          eol,
          needsEol: close.index === sourceStart,
        });
      }
      tokens.lastIndex = closes.lastIndex;
      continue;
    }
    if (groups.comment) {
      const end = answer.indexOf("-->", start + 4);
      tokens.lastIndex = end < 0 ? answer.length : end + 3;
      continue;
    }
    if (groups.inline) {
      const delimiter = /`+/g;
      delimiter.lastIndex = tokens.lastIndex;
      let end;
      while (
        (end = delimiter.exec(answer)) &&
        end[0].length !== groups.inline.length
      ) {}
      tokens.lastIndex = end ? delimiter.lastIndex : answer.length;
      continue;
    }
    const opening = tagAt(answer, start),
      name = groups.tag.replace(/^<\/?/, "").toLowerCase();
    if (
      groups.tag.startsWith("</") ||
      !["svg", "pre", "code", "script", "style", "textarea", "xmp"].includes(
        name,
      )
    ) {
      tokens.lastIndex = opening.end;
      continue;
    }
    const closing = closingElement(answer, start, name);
    if (name === "svg") {
      figures.push({
        kind: "svg",
        start,
        end: closing.end,
        sourceStart: start,
        sourceEnd: closing.end,
        wrapper: "svg",
      });
    } else if (
      name === "pre" &&
      /\bclass\s*=\s*(["'])mermaid\1/i.test(opening.raw)
    ) {
      figures.push({
        kind: "mermaid",
        start,
        end: closing.end,
        sourceStart: opening.end,
        sourceEnd: closing.start,
        wrapper: "pre",
      });
    }
    tokens.lastIndex = closing.end;
  }
  for (let i = 1; i < figures.length; i++)
    if (figures[i].start < figures[i - 1].end)
      throw Error("Overlapping static figures");

  return figures;
}
function replaceFigure(answer, figure, source) {
  validateFigureSource(figure.kind, source);
  let replacement = source;
  if (figure.wrapper === "fence") {
    replacement = source.replace(/\r?\n$/, "");
    // A formerly empty fence has no trailing source newline to retain.
    if (figure.needsEol) replacement += figure.eol;
  } else if (figure.wrapper === "pre") {
    replacement = source
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  return (
    answer.slice(0, figure.sourceStart) +
    replacement +
    answer.slice(figure.sourceEnd)
  );
}
module.exports = {
  figuresOf,
  validateFigureSource,
  replaceFigure,
  assertPresentationOnly,
  figureSource,
};
