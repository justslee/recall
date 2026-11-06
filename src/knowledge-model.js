import YAML from "yaml";
export function splitNote(raw) {
  const prefix = raw.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] || "";
  return { prefix, body: raw.slice(prefix.length) };
}
export function sourceTitle(raw, fallback) {
  try {
    const { prefix, body } = splitNote(raw);
    const document = YAML.parseDocument(
      prefix
        ? prefix.replace(/^---\r?\n/, "").replace(/\r?\n---(?:\r?\n|$)$/, "")
        : "",
    );
    const title = document.get("title");
    return typeof title === "string"
      ? title
      : body.match(/^#\s+(.+)$/m)?.[1] || fallback;
  } catch {
    return fallback;
  }
}
export function titleInSource(raw, title, previousTitle) {
  const { prefix, body } = splitNote(raw);
  const document = YAML.parseDocument(
    prefix
      ? prefix.replace(/^---\r?\n/, "").replace(/\r?\n---(?:\r?\n|$)$/, "")
      : "",
  );
  if (document.errors.length)
    throw Error("Fix the frontmatter before renaming this note.");
  document.set("title", title);
  const heading = body.match(/^#\s+(.+)$/m);
  const nextBody =
    heading && heading[1] === previousTitle
      ? body.replace(/^#\s+(.+)$/m, () => "# " + title)
      : body;
  return "---\n" + document.toString() + "---\n" + nextBody;
}
