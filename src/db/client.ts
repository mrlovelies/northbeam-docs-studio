import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const DEFAULT_PATH = process.env.DATABASE_PATH ?? "data/app.db";

// Open a better-sqlite3 connection with the PRAGMAs every connection needs.
// foreign_keys is OFF by default and set per-connection: without it here, the
// ON DELETE RESTRICT backstop for INV-3 (and CASCADE) is silently inert.
export function openSqlite(path: string = DEFAULT_PATH): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return sqlite;
}

export type DrizzleDb = BetterSQLite3Database<typeof schema>;

// Lazy, dev-safe singleton: built on first use, cached across Next hot-reload.
// Importing this module has no side effect, so tests can import openSqlite
// without opening the app's database.
const globalRef = globalThis as unknown as { __nbdsDb?: DrizzleDb };

export function getDb(): DrizzleDb {
  if (!globalRef.__nbdsDb) {
    globalRef.__nbdsDb = drizzle(openSqlite(), { schema });
  }
  return globalRef.__nbdsDb;
}
