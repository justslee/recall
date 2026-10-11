const crypto = require("node:crypto");
class ProtocolError extends globalThis.Error {}
const Error = (message) => new ProtocolError(message);
const VERSION = 1;
const LIMITS = Object.freeze({
  pages: 20,
  imageBytes: 12 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  drawingBytes: 32 * 1024 * 1024,
  dimension: 16384,
  pixels: 32_000_000,
  manifestBytes: 64 * 1024,
  questions: 200,
  frontBytes: 16 * 1024 * 1024,
});
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hashPattern = /^[a-f0-9]{64}$/;
const digest = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
function checkedId(id) {
  if (typeof id !== "string" || !uuid.test(id))
    throw Error("Invalid identifier.");
  return id;
}
function text(value, limit, name) {
  if (typeof value !== "string" || value.length > limit)
    throw Error("Invalid " + name + ".");
  return value;
}
function manifest(input) {
  if (
    !input ||
    ![VERSION, 2].includes(input.version) ||
    !["study", "tutor"].includes(input.mode)
  )
    throw Error("Unsupported handwriting submission.");
  checkedId(input.id);
  checkedId(input.documentId);
  checkedId(input.handoffId);
  if (
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    !Number.isFinite(Date.parse(input.createdAt))
  )
    throw Error("Invalid submission revision or date.");
  const assistant = input.version === 2;
  if (assistant && (input.mode !== "tutor" || input.target !== "assistant"))
    throw Error("Version 2 requires an assistant paper session.");
  if (input.mode === "study" || assistant) checkedId(input.questionId);
  else if (input.questionId !== null)
    throw Error("Tutor sheets must not request a card reference.");
  if (
    typeof input.evaluate !== "boolean" ||
    (input.mode === "tutor" && input.evaluate)
  )
    throw Error("Invalid evaluation request.");
  if (
    input.target !== undefined &&
    (input.mode !== "tutor" ||
      !(assistant
        ? input.target === "assistant"
        : ["clipboard", "chatgpt", "codex"].includes(input.target)))
  )
    throw Error("Invalid Tutor Pad submission destination.");
  // New work uses clipboard. Historical destinations and an omitted field stay
  // unchanged so queued retries retain their original immutable manifest hash.
  if (
    !Array.isArray(input.pages) ||
    !input.pages.length ||
    input.pages.length > LIMITS.pages
  )
    throw Error("Use 1–20 pages per submission.");
  const pages = input.pages.map((p, i) => {
    if (
      p.index !== i ||
      !hashPattern.test(p.hash) ||
      !["image/png", "image/jpeg", "image/webp"].includes(p.mime)
    )
      throw Error("Invalid page order, digest or format.");
    if (
      ![p.width, p.height].every(
        (v) => Number.isSafeInteger(v) && v > 0 && v <= LIMITS.dimension,
      ) ||
      p.width * p.height > LIMITS.pixels
    )
      throw Error("Image dimensions exceed the supported size.");
    return {
      index: i,
      hash: p.hash,
      mime: p.mime,
      name: text(p.name, 160, "page name"),
      width: p.width,
      height: p.height,
    };
  });
  let drawing = null;
  if (input.drawing !== null && input.drawing !== undefined) {
    if (
      !hashPattern.test(input.drawing.hash) ||
      !Number.isSafeInteger(input.drawing.bytes) ||
      input.drawing.bytes < 1 ||
      input.drawing.bytes > LIMITS.drawingBytes
    )
      throw Error("Invalid editable drawing.");
    drawing = { hash: input.drawing.hash, bytes: input.drawing.bytes };
  }
  const known = new Map();
  for (const page of pages) {
    const signature = `${page.mime}:${page.width}:${page.height}`;
    if (known.has(page.hash) && known.get(page.hash) !== signature)
      throw Error(
        "Repeated page data must have consistent dimensions and format.",
      );
    known.set(page.hash, signature);
  }
  if (drawing && known.has(drawing.hash))
    throw Error("Drawing and image data must have distinct digests.");
  return {
    version: input.version,
    id: input.id,
    documentId: input.documentId,
    revision: input.revision,
    mode: input.mode,
    questionId: input.questionId,
    handoffId: input.handoffId,
    createdAt: input.createdAt,
    pages,
    drawing,
    evaluate: input.evaluate,
    ...(input.target === undefined ? {} : { target: input.target }),
  };
}
function imageInfo(bytes, mime, decode) {
  bytes = Buffer.from(bytes);
  if (!bytes.length || bytes.length > LIMITS.imageBytes)
    throw Error("Use PNG, JPEG or WebP up to 12 MB.");
  let width, height;
  if (
    mime === "image/png" &&
    bytes.length >= 45 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
    let cursor = 8,
      ended = false,
      data = false;
    while (cursor + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(cursor),
        kind = bytes.toString("ascii", cursor + 4, cursor + 8);
      if (size > bytes.length - cursor - 12)
        throw Error("Truncated PNG image.");
      if (kind === "IDAT") data = true;
      cursor += size + 12;
      if (kind === "IEND") {
        ended = size === 0 && cursor === bytes.length;
        break;
      }
    }
    if (!ended || !data) throw Error("Incomplete PNG image.");
  } else if (
    mime === "image/jpeg" &&
    bytes.length > 8 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  ) {
    let cursor = 2;
    while (cursor + 4 < bytes.length) {
      if (bytes[cursor++] !== 0xff) break;
      while (bytes[cursor] === 0xff) cursor++;
      const marker = bytes[cursor++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const size = bytes.readUInt16BE(cursor);
      if (size < 2 || cursor + size > bytes.length)
        throw Error("Truncated JPEG image.");
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        height = bytes.readUInt16BE(cursor + 3);
        width = bytes.readUInt16BE(cursor + 5);
        break;
      }
      cursor += size;
    }
  } else if (
    mime === "image/webp" &&
    bytes.length >= 30 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    bytes.readUInt32LE(4) + 8 === bytes.length
  ) {
    const kind = bytes.toString("ascii", 12, 16);
    if (kind === "VP8X") {
      if (bytes[20] & 2) throw Error("Animated images are unsupported.");
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    } else if (kind === "VP8L" && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (
      kind === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 1 &&
      bytes[25] === 0x2a
    ) {
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    }
  }
  if (
    !width ||
    !height ||
    width > LIMITS.dimension ||
    height > LIMITS.dimension ||
    width * height > LIMITS.pixels
  )
    throw Error("Invalid image format or dimensions.");
  if (decode) {
    const decoded = decode(bytes);
    if (!decoded || decoded.width !== width || decoded.height !== height)
      throw Error("The image could not be decoded safely.");
  }
  return { width, height, mime, bytes: bytes.length };
}
function referenceText(html) {
  const entities = (text) =>
    text
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  const formulas = [],
    prefix = "recall-formula-" + crypto.randomUUID() + "-";
  let text = String(html || "")
    .replace(/```(?:widget|mermaid)[^\n]*\n[\s\S]*?```/gi, " ")
    .replace(/<(script|style|svg|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(
      /\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\n])+\$/g,
      (formula) => {
        const index = formulas.push(formula) - 1;
        return prefix + index + "-end";
      },
    )
    .replace(/<br\s*\/?\s*>|<\/(?:p|li|div|h[1-6])>/gi, "\n")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<\/?[a-z][a-z0-9:-]*(?:\s+[^<>]*?)?\s*\/?>/gi, " ")
    .trim();
  text = entities(text);
  for (let i = 0; i < formulas.length; i++)
    text = text.replace(prefix + i + "-end", entities(formulas[i]));
  return text;
}
function safeFront(html) {
  return referenceText(html)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}
function questionFront(html, decode) {
  const images = [],
    prefix = "recall-image-" + crypto.randomUUID() + "-";
  if (
    /<(?:svg|iframe|object|embed)\b|```(?:widget|mermaid)\b/i.test(String(html))
  )
    throw Error(
      "This question uses an interactive or vector figure. Use the Mac question with Tutor Pad, or embed a static PNG/JPEG/WebP illustration.",
    );
  const source = String(html).replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i),
      url = src?.[1] ?? src?.[2] ?? src?.[3] ?? "";
    const inline = url.match(
      /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i,
    );
    if (!inline)
      throw Error(
        "This question needs an embedded PNG/JPEG/WebP illustration to write on iPad. Keep external illustrations on the Mac with Tutor Pad.",
      );
    if (images.length >= 4 || inline[2].length > (2 * 1024 * 1024 * 4) / 3)
      throw Error(
        "Question illustrations must be up to 2 MB each, with at most four images.",
      );
    const bytes = Buffer.from(inline[2], "base64"),
      mime = inline[1].toLowerCase();
    imageInfo(bytes, mime, decode);
    const index = images.length;
    images.push({ mime, data: bytes.toString("base64") });
    return prefix + index + "-end";
  });
  let rendered = safeFront(source);
  for (let i = 0; i < images.length; i++)
    rendered = rendered.replace(
      prefix + i + "-end",
      `<img src="data:${images[i].mime};base64,${images[i].data}" alt="Question illustration ${i + 1}">`,
    );
  return { html: rendered, images };
}
module.exports = {
  VERSION,
  LIMITS,
  checkedId,
  digest,
  manifest,
  imageInfo,
  referenceText,
  safeFront,
  questionFront,
  ProtocolError,
};
