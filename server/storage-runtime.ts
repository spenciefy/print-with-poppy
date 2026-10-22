import { AsyncLocalStorage } from "node:async_hooks";
export interface DatabaseAdapter {
  prepare(sql: string): {
    get(...args: any[]): any;
    all(...args: any[]): any[];
    run(...args: any[]): { changes: number };
  };
  close(): void;
  exec(sql: string): unknown;
  transaction<T>(fn: () => T): () => T;
}
const scope = new AsyncLocalStorage<DatabaseAdapter>();
let fallback: DatabaseAdapter | undefined;
export function installDatabase(db: DatabaseAdapter) {
  fallback = db;
}
export function withDatabase<T>(db: DatabaseAdapter, fn: () => T): T {
  return scope.run(db, fn);
}
export const database = new Proxy({} as DatabaseAdapter, {
  get(_target, key) {
    const db = scope.getStore() ?? fallback;
    if (!db) throw new Error("Database context missing.");
    const value = Reflect.get(db, key);
    return typeof value === "function" ? value.bind(db) : value;
  },
});
