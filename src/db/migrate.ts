import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import type DatabaseType from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openSqlite } from "./client";

const MIGRATIONS_DIR = join(import.meta.dirname, "../../drizzle");

// INV-1: published version rows are write-once. The service has no update path
// to them; this trigger is the DB-level teeth that aborts any UPDATE regardless
// of caller (e.g. a stray ORM full-row save). Deletes are unaffected (a non-live
// version may be deleted); the live version is protected by the FK, not this.
const IMMUTABILITY_TRIGGER = `
CREATE TRIGGER IF NOT EXISTS article_versions_immutable
BEFORE UPDATE ON article_versions
BEGIN
  SELECT RAISE(ABORT, 'article_versions are immutable (INV-1)');
END;
`;

// Apply schema migrations and the immutability trigger to an open connection.
// This is the single supported init path (the setup CLI and the test harness
// both call it). The trigger can't be expressed in the Drizzle schema, so it is
// applied here rather than in the generated migration SQL; initializing a DB by
// running drizzle-kit directly would skip it (the service-level INV-1 guarantee
// still holds, but the DB-level backstop would be absent until setup runs).
export function applyMigrations(sqlite: DatabaseType.Database): void {
  migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR });
  sqlite.exec(IMMUTABILITY_TRIGGER);
}

// Run as a CLI (`npm run setup`) to migrate the app database. Guarded so that
// importing applyMigrations (e.g. from tests) never touches the app database.
function isMain(): boolean {
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMain()) {
  const sqlite = openSqlite();
  applyMigrations(sqlite);
  sqlite.close();
  console.log("Migrations applied.");
}
