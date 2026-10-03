// External links only select a local card. They cannot reveal, rate, or run it.
function cardLink(id) {
  if (
    typeof id !== "string" ||
    !id ||
    id.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(id) ||
    [".", ".."].includes(id)
  )
    throw Error("Invalid card ID");
  return (
    "recall://card/" +
    encodeURIComponent(id).replace(
      /[!'()*]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    )
  );
}
function parseCardLink(value) {
  if (typeof value !== "string" || value.length > 16384)
    throw Error("Invalid Recall card link");
  const match = /^recall:\/\/card\/([^/?#]+)$/.exec(value);
  if (!match) throw Error("Invalid Recall card link");
  try {
    const id = decodeURIComponent(match[1]);
    cardLink(id);
    return id;
  } catch {
    throw Error("Invalid Recall card link");
  }
}
module.exports = { cardLink, parseCardLink };
