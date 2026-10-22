import type { DatabaseAdapter } from "../server/storage-runtime.js";
export function sqlite(
  storage: DurableObjectStorage,
  fence: () => void = () => {},
): DatabaseAdapter {
  return {
    close() {},
    exec(sql) {
      fence();
      storage.sql.exec(sql);
    },
    prepare(sql) {
      const args = (values: any[]) =>
        values.map((v) => (v === undefined ? null : v));
      return {
        get(...values) {
          return storage.sql.exec(sql, ...args(values)).toArray()[0];
        },
        all(...values) {
          return storage.sql.exec(sql, ...args(values)).toArray();
        },
        run(...values) {
          fence();
          const result = storage.sql.exec(sql, ...args(values));
          return { changes: result.rowsWritten };
        },
      };
    },
    transaction(fn) {
      return () =>
        storage.transactionSync(() => {
          fence();
          return fn();
        });
    },
  };
}
