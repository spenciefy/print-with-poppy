export function initializeStore(db: { exec(sql: string): unknown }) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,owner TEXT NOT NULL DEFAULT '',body TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE INDEX IF NOT EXISTS records_owner ON records(kind,owner); CREATE TABLE IF NOT EXISTS replay (id TEXT PRIMARY KEY,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,kind TEXT NOT NULL,record_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,error TEXT);`,
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS orders_account ON records(json_extract(body, '$.accountId'), json_extract(body, '$.created'), id) WHERE kind='order'",
  );
}
