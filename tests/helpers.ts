import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type DatabaseType from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { openSqlite, type DrizzleDb } from "@/src/db/client";
import { applyMigrations } from "@/src/db/migrate";
import * as schema from "@/src/db/schema";

export interface TestDb {
  db: DrizzleDb;
  sqlite: DatabaseType.Database;
  path: string;
  /** Clear all rows between tests (migrate-once, truncate-per-test). */
  truncate: () => void;
  /** A second independent connection to the same file, for concurrency tests. */
  openConnection: () => DrizzleDb;
  /** Close every connection and remove the temp directory. */
  close: () => void;
}

// Create a migrated temp-file database for a test suite. Migrate once per suite;
// call truncate() in beforeEach for isolation and close() in afterAll.
export function createTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), "nbds-"));
  const path = join(dir, "test.db");
  const sqlite = openSqlite(path);
  applyMigrations(sqlite);
  const db = drizzle(sqlite, { schema });

  const extra: DatabaseType.Database[] = [];

  function truncate() {
    // FK OFF so order/pointers don't block the wipe; the immutability trigger
    // is BEFORE UPDATE only, so deletes are unaffected.
    sqlite.pragma("foreign_keys = OFF");
    sqlite.exec("DELETE FROM article_versions; DELETE FROM articles;");
    sqlite.pragma("foreign_keys = ON");
  }

  function openConnection(): DrizzleDb {
    const conn = openSqlite(path);
    extra.push(conn);
    return drizzle(conn, { schema });
  }

  function close() {
    for (const conn of extra) conn.close();
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }

  return { db, sqlite, path, truncate, openConnection, close };
}
