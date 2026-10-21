import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initializeStore } from "../server/store-schema.js";
import { exportSnapshot, importSnapshot } from "../server/migration.js";
test("logical migration is atomic, identity-bound, dry-run capable and resumable", () => {
  const source = new Database(":memory:"),
    target = new Database(":memory:");
  initializeStore(source);
  initializeStore(target);
  source
    .prepare("INSERT INTO records VALUES(?,?,?,?)")
    .run(
      "order",
      "synthetic-order",
      "synthetic-owner",
      JSON.stringify({ id: "synthetic-order", status: "paid" }),
    );
  source
    .prepare("INSERT INTO jobs(id,kind,record_id) VALUES(?,?,?)")
    .run("fulfill:synthetic-order", "fulfill", "synthetic-order");
  const identity = {
    origin: "https://synthetic.example",
    environment: "demo" as const,
  };
  const snapshot = exportSnapshot(source, identity);
  importSnapshot(target, snapshot, identity);
  assert.equal(
    (target.prepare("SELECT count(*) AS n FROM records").get() as { n: number })
      .n,
    0,
  );
  assert.throws(
    () =>
      importSnapshot(
        target,
        snapshot,
        { ...identity, environment: "live" },
        false,
      ),
    /mismatch/,
  );
  importSnapshot(target, snapshot, identity, false);
  assert.equal(
    (target.prepare("SELECT count(*) AS n FROM records").get() as { n: number })
      .n,
    1,
  );
  assert.deepEqual(importSnapshot(target, snapshot, identity, false), {
    digest: importSnapshot(target, snapshot, identity).digest,
    resumed: true,
  });
  const altered = structuredClone(snapshot);
  altered.records[0].body = "{}";
  assert.throws(
    () => importSnapshot(target, altered, identity, false),
    /empty/,
  );
  assert.deepEqual(exportSnapshot(target, identity), snapshot);
  source.close();
  target.close();
});
