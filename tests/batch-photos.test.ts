import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePhotoBatch, batchBytes } from "../server/batch-photos.js";
async function parse(form: FormData) {
  const r = new Response(form);
  return parsePhotoBatch(
    new Uint8Array(await r.arrayBuffer()),
    r.headers.get("Content-Type")!,
  );
}
test("batch rejects ambiguous fields, text, empty files and oversized combined payloads", async () => {
  for (const entries of [
    [],
    [["photo1", "text"]],
    [["unknown", new Blob(["x"])]],
    [
      ["photo1", new Blob(["x"])],
      ["photo1", new Blob(["y"])],
    ],
    [["photo1", new Blob([])]],
    [
      ["photo1", new Blob([new Uint8Array(batchBytes)])],
      ["photo2", new Blob(["x"])],
    ],
  ] as [string, string | Blob][][]) {
    const form = new FormData();
    for (const [field, value] of entries) form.append(field, value);
    await assert.rejects(parse(form));
  }
});
test("batch supports PDA named file fields in numerical order without requiring contiguous slots", async () => {
  const form = new FormData();
  form.append("photo10", new Blob(["ten"]), "sensitive-name.jpg");
  form.append("photo2", new Blob(["two"]));
  assert.deepEqual(
    (await parse(form)).map((f) => f.field),
    ["photo2", "photo10"],
  );
});
