import Database from "better-sqlite3";
import fs from "node:fs";
import {
  randomBytes,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { config } from "./config.js";
fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(`${config.dataDir}/photos`, { recursive: true, mode: 0o700 });
export const db = new Database(`${config.dataDir}/poppy.sqlite`);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.exec(
  `CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,owner TEXT NOT NULL DEFAULT '',body TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE INDEX IF NOT EXISTS records_owner ON records(kind,owner); CREATE TABLE IF NOT EXISTS replay (id TEXT PRIMARY KEY,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,kind TEXT NOT NULL,record_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,error TEXT);`,
);
export function get<T = any>(kind: string, id: string): T | undefined {
  const r = db
    .prepare("SELECT body FROM records WHERE kind=? AND id=?")
    .get(kind, id) as any;
  return r ? JSON.parse(r.body) : undefined;
}
export function put(kind: string, id: string, body: unknown, owner = "") {
  db.prepare(
    "INSERT INTO records(kind,id,owner,body) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body,owner=excluded.owner",
  ).run(kind, id, owner, JSON.stringify(body));
}
export function all<T = any>(kind: string, owner?: string): T[] {
  return (
    owner === undefined
      ? db.prepare("SELECT body FROM records WHERE kind=?").all(kind)
      : db
          .prepare("SELECT body FROM records WHERE kind=? AND owner=?")
          .all(kind, owner)
  ).map((r: any) => JSON.parse(r.body));
}
export function remove(kind: string, id: string) {
  db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
}
export const id = (prefix: string) =>
  `${prefix}_${randomBytes(18).toString("base64url")}`;
export const hash = (s: string) =>
  createHash("sha256").update(s).digest("base64url");
export function once(key: string, expires = Date.now() + 120000) {
  db.prepare("DELETE FROM replay WHERE expires<?").run(Date.now());
  try {
    db.prepare("INSERT INTO replay VALUES(?,?)").run(key, expires);
  } catch {
    throw new HttpError(
      400,
      "invalid_grant",
      "This proof has already been used.",
    );
  }
}
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export function requireRecord<T = any>(
  kind: string,
  rid: string,
  owner?: string,
): T {
  const r = get<T>(kind, rid);
  if (!r || (owner !== undefined && (r as any).owner !== owner))
    throw new HttpError(
      404,
      kind === "operation" ? "operation_not_found" : "not_found",
      "Not found.",
    );
  return r;
}
export function enqueue(kind: string, rid: string, key = `${kind}:${rid}`) {
  db.prepare("INSERT OR IGNORE INTO jobs(id,kind,record_id) VALUES(?,?,?)").run(
    key,
    kind,
    rid,
  );
}
export function sign(value: string) {
  return createHmac("sha256", config.secret).update(value).digest("base64url");
}
export function equal(a: string, b: string) {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function mediaUrl(assetId: string, variant: string, seconds = 3600) {
  const exp = Math.floor(Date.now() / 1000) + seconds;
  return `${config.origin}/media/${assetId}/${variant}?exp=${exp}&sig=${sign(`${assetId}:${variant}:${exp}`)}`;
}
