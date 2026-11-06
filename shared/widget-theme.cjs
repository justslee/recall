const fs = require("node:fs"),
  path = require("node:path");

// Shared is packaged with the app. Runtime rendering never reads src/ or a
// user's files, and the web build resolves its CSS import at build time.
const theme = fs.readFileSync(path.join(__dirname, "visual-theme.css"), "utf8");
const declarations = (source) =>
  Object.fromEntries(
    [...source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [
      m[1],
      m[2].trim(),
    ]),
  );
const [dark, light] = theme.split("@media");
module.exports = {
  theme,
  tokens: declarations(dark),
  lightTokens: declarations(light),
};
