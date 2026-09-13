const fs = require("node:fs"),
  path = require("node:path"),
  Ajv = require("ajv");
const ajv = new Ajv({ allErrors: true });
for (const file of fs
  .readdirSync(path.join(__dirname, "../schemas"))
  .filter((f) => f.endsWith(".json")))
  ajv.addSchema(require("../schemas/" + file));
function validate(name, value) {
  const check = ajv.getSchema(name);
  if (!check || !check(value))
    throw Error(`${name}: ${ajv.errorsText(check?.errors)}`);
  return value;
}
module.exports = { validate };
