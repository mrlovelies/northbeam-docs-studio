import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { openSqlite, type DrizzleDb } from "./client";
import { applyMigrations } from "./migrate";
import * as schema from "./schema";
import { createArticle, publish } from "../domain/articles";

// Demo content so a fresh checkout has something to read and edit. Seeding goes
// through the real service (createArticle + publish), so the seed itself
// exercises the invariants rather than hand-writing rows.
interface SeedArticle {
  slug: string;
  title: string;
  body: string;
  tags: string[];
  publish: boolean;
}

const SEEDS: SeedArticle[] = [
  {
    slug: "getting-started",
    title: "Getting Started",
    body: "# Getting Started\n\nWelcome to **Northbeam Docs Studio**.\n\n- Write a draft in the Studio\n- Publish it to mint a numbered, immutable version\n- Readers only ever see the published version, never your draft",
    tags: ["guide", "intro"],
    publish: true,
  },
  {
    slug: "versioning-model",
    title: "How Versioning Works",
    body: "# How Versioning Works\n\nEach **publish** snapshots the current draft as a numbered, immutable version and points the article at it.\n\nEditing the draft afterward never changes what readers see, until you publish again and mint the next version. Old versions can be restored back into the draft, and any version except the live one can be deleted.",
    tags: ["concepts"],
    publish: true,
  },
  {
    slug: "internal-roadmap",
    title: "Internal Roadmap",
    body: "# Internal Roadmap\n\nLeft as an unpublished draft on purpose: it shows up here in the Studio but not on the public docs site.",
    tags: ["internal"],
    publish: false,
  },
];

// Idempotent: skips any article whose slug already exists, so running setup
// repeatedly never duplicates or errors.
export function seed(db: DrizzleDb): { created: number; skipped: number } {
  let created = 0;
  let skipped = 0;
  for (const s of SEEDS) {
    const existing = db
      .select({ id: schema.articles.id })
      .from(schema.articles)
      .where(eq(schema.articles.slug, s.slug))
      .get();
    if (existing) {
      skipped++;
      continue;
    }
    const article = createArticle(db, { slug: s.slug, title: s.title, body: s.body, tags: s.tags });
    if (s.publish) publish(db, article.id, article.draftVersion);
    created++;
  }
  return { created, skipped };
}

// CLI entrypoint for `npm run setup`: migrate (idempotent) then seed
// (idempotent). Guarded so importing seed() from tests never runs it.
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
  const db = drizzle(sqlite, { schema });
  const { created, skipped } = seed(db);
  sqlite.close();
  console.log(`Setup complete: migrations applied; seed ${created} created, ${skipped} already present.`);
}
