/**
 * expo-sqlite for jest, backed by a REAL SQLite engine (Node's built-in
 * `node:sqlite`).
 *
 * The other SQLite suites here (backup/ledger, incar/recents) sniff SQL strings
 * over a Map. That is workable for a handful of statements and hopeless for the
 * offline store, whose guarantees live in joins, ON CONFLICT clauses and
 * `missing_count >= 2` deletes - a fake that guesses at them would pass the very
 * queries these tests exist to catch. Test-only: nothing in the app imports it.
 *
 * Use from a test file:
 *   jest.mock("expo-sqlite", () => require("./testing/sqliteNode").sqliteModule);
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...p: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
      all(...p: unknown[]): Record<string, unknown>[];
      get(...p: unknown[]): Record<string, unknown> | undefined;
    };
    close(): void;
  };
};

type Native = InstanceType<typeof DatabaseSync>;

/** Open databases by `<directory>/<name>`, so reopening one sees its data, as on a device. */
export const sqliteState = {
  dbs: new Map<string, Native>(),
  opened: [] as { name: string; directory: string | undefined }[],
};

function flat(params: unknown[]): unknown[] {
  const p = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
  // node:sqlite rejects booleans and undefined; expo-sqlite binds them as 0/1 and NULL.
  return p.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
}

function plain<T>(row: Record<string, unknown> | undefined): T | null {
  return row ? ({ ...row } as T) : null;
}

function wrap(native: Native, key: string) {
  let closed = false;
  const live = () => {
    if (closed) throw new Error(`database ${key} is closed`);
    return native;
  };
  return {
    execAsync: jest.fn(async (sql: string) => { live().exec(sql); }),
    runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
      const r = live().prepare(sql).run(...flat(params));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    }),
    getAllAsync: jest.fn(async <T>(sql: string, ...params: unknown[]) =>
      live().prepare(sql).all(...flat(params)).map((r) => ({ ...r }) as T)),
    getFirstAsync: jest.fn(async <T>(sql: string, ...params: unknown[]) =>
      plain<T>(live().prepare(sql).get(...flat(params)))),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => {
      live().exec("BEGIN");
      try {
        await fn();
        live().exec("COMMIT");
      } catch (e) {
        live().exec("ROLLBACK");
        throw e;
      }
    }),
    closeAsync: jest.fn(async () => { closed = true; }),
  };
}

export const sqliteModule = {
  openDatabaseAsync: jest.fn(async (name: string, _options?: unknown, directory?: string) => {
    sqliteState.opened.push({ name, directory });
    const key = `${directory ?? ""}/${name}`;
    let native = sqliteState.dbs.get(key);
    if (!native) {
      native = new DatabaseSync(":memory:");
      sqliteState.dbs.set(key, native);
    }
    return wrap(native, key);
  }),
};

/** Forget every database, as a fresh install would. */
export function resetSqlite(): void {
  for (const d of sqliteState.dbs.values()) d.close();
  sqliteState.dbs.clear();
  sqliteState.opened.length = 0;
}

/** Drop the databases under a directory, as deleting that directory on disk would. */
export function dropSqliteUnder(directoryPrefix: string): void {
  for (const [k, d] of [...sqliteState.dbs.entries()]) {
    if (k.startsWith(directoryPrefix)) {
      d.close();
      sqliteState.dbs.delete(k);
    }
  }
}
