import fs from "node:fs";
import assert from "node:assert/strict";
import { validateSchema } from "../vendor/poppy-0.4/schema.js";
const directory = new URL("../vendor/poppy-0.4/schemas/", import.meta.url);
const schemas = Object.fromEntries(fs.readdirSync(directory).map((name) => [name, JSON.parse(fs.readFileSync(new URL(name, directory), "utf8"))]));
export function officialSchema(name: string, value: unknown) {
  const schema = schemas[`${name}.schema.json`];
  assert(schema, `Unknown official schema ${name}`);
  assert.deepEqual(validateSchema(schema, value, schemas), [], `Official 0.4 schema: ${name}`);
}
