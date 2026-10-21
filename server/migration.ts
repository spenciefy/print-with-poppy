import { createHash } from "node:crypto";
import type { DatabaseAdapter } from "./storage-runtime.js";
import { z } from "zod";
const record = z
  .object({
    kind: z.string(),
    id: z.string(),
    owner: z.string(),
    body: z.string().refine((s) => {
      try {
        JSON.parse(s);
        return true;
      } catch {
        return false;
      }
    }),
  })
  .strict();
const job = z
  .object({
    id: z.string(),
    kind: z.string(),
    record_id: z.string(),
    state: z.enum(["pending", "done", "failed"]),
    attempts: z.number().int().nonnegative(),
    next_at: z.number(),
    error: z.string().nullable(),
  })
  .strict();
const payload = z
  .object({
    version: z.literal(1),
    origin: z.url(),
    environment: z.enum(["demo", "sandbox", "live"]),
    records: z.array(record),
    replay: z.array(z.object({ id: z.string(), expires: z.number() }).strict()),
    jobs: z.array(job),
    assets: z.array(
      z
        .object({
          key: z.string().min(1),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          size: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();
export type Snapshot = z.infer<typeof payload>;
export function snapshotDigest(value: Snapshot) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function exportSnapshot(
  db: DatabaseAdapter,
  identity: Pick<Snapshot, "origin" | "environment">,
  assets: Snapshot["assets"] = [],
): Snapshot {
  return db.transaction(() =>
    payload.parse({
      version: 1,
      ...identity,
      records: db
        .prepare("SELECT kind,id,owner,body FROM records ORDER BY kind,id")
        .all(),
      replay: db
        .prepare("SELECT id,expires FROM replay WHERE expires>? ORDER BY id")
        .all(Date.now()),
      jobs: db
        .prepare(
          "SELECT id,kind,record_id,state,attempts,next_at,error FROM jobs ORDER BY id",
        )
        .all(),
      assets,
    }),
  )();
}
export function importSnapshot(
  db: DatabaseAdapter,
  input: unknown,
  target: Pick<Snapshot, "origin" | "environment">,
  dryRun = true,
) {
  const snapshot = payload.parse(input);
  if (
    snapshot.origin !== target.origin ||
    snapshot.environment !== target.environment
  )
    throw new Error(
      "Snapshot identity mismatch. Never silently rewrite issuer or environment.",
    );
  const digest = snapshotDigest(snapshot);
  const duplicates = new Set<string>();
  for (const row of snapshot.records) {
    const key = JSON.stringify([row.kind, row.id]);
    if (duplicates.has(key)) throw new Error("Duplicate record identity.");
    duplicates.add(key);
  }
  if (dryRun)
    return {
      digest,
      records: snapshot.records.length,
      jobs: snapshot.jobs.length,
      assets: snapshot.assets.length,
      dryRun: true,
    };
  return db.transaction(() => {
    db.exec(
      "CREATE TABLE IF NOT EXISTS migration_imports(digest TEXT PRIMARY KEY,completed INTEGER NOT NULL)",
    );
    if (
      db
        .prepare("SELECT digest FROM migration_imports WHERE digest=?")
        .get(digest)
    )
      return { digest, resumed: true };
    if (
      db.prepare("SELECT id FROM records LIMIT 1").get() ||
      db.prepare("SELECT id FROM jobs LIMIT 1").get()
    )
      throw new Error(
        "Import target must be empty or already contain this exact import.",
      );
    for (const r of snapshot.records)
      db.prepare("INSERT INTO records(kind,id,owner,body) VALUES(?,?,?,?)").run(
        r.kind,
        r.id,
        r.owner,
        r.body,
      );
    for (const r of snapshot.replay)
      if (r.expires > Date.now())
        db.prepare("INSERT INTO replay(id,expires) VALUES(?,?)").run(
          r.id,
          r.expires,
        );
    for (const r of snapshot.jobs)
      db.prepare(
        "INSERT INTO jobs(id,kind,record_id,state,attempts,next_at,error) VALUES(?,?,?,?,?,?,?)",
      ).run(r.id, r.kind, r.record_id, r.state, r.attempts, r.next_at, r.error);
    db.prepare("INSERT INTO migration_imports VALUES(?,?)").run(
      digest,
      Date.now(),
    );
    return { digest, resumed: false };
  })();
}
