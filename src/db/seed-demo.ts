import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { openSqlite, type DrizzleDb } from "./client";
import { applyMigrations } from "./migrate";
import * as schema from "./schema";
import {
  createArticle,
  updateDraft,
  publish,
  unpublish,
  restore,
  deleteVersion,
  getArticle,
} from "../domain/articles";

// Richer demo content than the minimal `npm run setup` seed: articles with
// multi-version histories and every interesting lifecycle state, so a reviewer
// can click through real data (versions, restore, unpublished, a deleted
// non-live version) without building any of it up by hand. Not wired into
// setup; run explicitly with `npm run seed:demo`. Idempotent per slug, and the
// slugs are distinct from the setup seed so the two can coexist.

function exists(db: DrizzleDb, slug: string): boolean {
  return !!db
    .select({ id: schema.articles.id })
    .from(schema.articles)
    .where(eq(schema.articles.slug, slug))
    .get();
}

// Edit the draft (carrying the current token), then publish it; returns the new version.
function editAndPublish(
  db: DrizzleDb,
  id: string,
  patch: { title?: string; body?: string; tags?: string[] },
) {
  updateDraft(db, id, { ...patch, expectedVersion: getArticle(db, id).draftVersion });
  return publish(db, id, getArticle(db, id).draftVersion);
}

function editDraft(
  db: DrizzleDb,
  id: string,
  patch: { title?: string; body?: string; tags?: string[] },
) {
  updateDraft(db, id, { ...patch, expectedVersion: getArticle(db, id).draftVersion });
}

export function seedDemo(db: DrizzleDb): { created: number; skipped: number } {
  let created = 0;
  let skipped = 0;
  const once = (slug: string, build: () => void) => {
    if (exists(db, slug)) {
      skipped++;
      return;
    }
    build();
    created++;
  };

  // 1. Three-version history, newest is live.
  once("product-overview", () => {
    const a = createArticle(db, {
      slug: "product-overview",
      title: "Product Overview",
      body: "# Product Overview\n\nWhat Northbeam does, at a glance.",
      tags: ["guide"],
    });
    publish(db, a.id, a.draftVersion); // v1
    editAndPublish(db, a.id, {
      body: "# Product Overview\n\nWhat Northbeam does, at a glance.\n\n## Pipelines\n\nIngest, model, attribute.",
    }); // v2
    editAndPublish(db, a.id, {
      body: "# Product Overview\n\nWhat Northbeam does, at a glance.\n\n## Pipelines\n\nIngest, model, attribute.\n\n## Reporting\n\nDashboards and exports.",
    }); // v3
  });

  // 2. Published, with draft edits sitting ahead of the live version.
  once("onboarding-guide", () => {
    const a = createArticle(db, {
      slug: "onboarding-guide",
      title: "Onboarding Guide",
      body: "# Onboarding\n\nStep 1: create an account.",
      tags: ["guide", "intro"],
    });
    publish(db, a.id, a.draftVersion); // v1
    editAndPublish(db, a.id, {
      body: "# Onboarding\n\nStep 1: create an account.\n\nStep 2: connect a data source.",
    }); // v2
    // Draft moves ahead of v2 but is not published: readers still see v2.
    editDraft(db, a.id, {
      body: "# Onboarding\n\nStep 1: create an account.\n\nStep 2: connect a data source.\n\nStep 3: invite your team. (draft, not yet published)",
    });
  });

  // 3. An older version restored into the draft (INV-4): draft shows v1, live is still v2.
  once("api-authentication", () => {
    const a = createArticle(db, {
      slug: "api-authentication",
      title: "API Authentication",
      body: "# Authentication\n\nUse an API key in the `Authorization` header.",
      tags: ["api"],
    });
    const v1 = publish(db, a.id, a.draftVersion); // v1
    editAndPublish(db, a.id, {
      body: "# Authentication\n\nUse an **OAuth token** in the `Authorization` header.\n\nAPI keys are deprecated.",
    }); // v2 (live)
    restore(db, a.id, v1.id, getArticle(db, a.id).draftVersion); // draft now holds v1
  });

  // 4. Published then unpublished (INV-6): hidden from readers, snapshot + date kept.
  once("data-retention-policy", () => {
    const a = createArticle(db, {
      slug: "data-retention-policy",
      title: "Data Retention Policy",
      body: "# Data Retention\n\nRaw events are kept for 25 months.",
      tags: ["policy"],
    });
    publish(db, a.id, a.draftVersion); // v1
    unpublish(db, a.id);
  });

  // 5. A deleted non-live version leaves a gap in the numbering (INV-3 allows non-live deletes).
  once("changelog", () => {
    const a = createArticle(db, {
      slug: "changelog",
      title: "Changelog",
      body: "# Changelog\n\n## v1\n\nInitial release.",
      tags: ["release-notes"],
    });
    publish(db, a.id, a.draftVersion); // v1
    const v2 = editAndPublish(db, a.id, {
      body: "# Changelog\n\n## v1\n\nInitial release.\n\n## v2\n\nBug fixes.",
    }); // v2
    editAndPublish(db, a.id, {
      body: "# Changelog\n\n## v1\n\nInitial release.\n\n## v3\n\nNew reporting API.",
    }); // v3 (live)
    deleteVersion(db, a.id, v2.id); // remove the non-live v2; history keeps 1 and 3
  });

  // 6. Draft only, never published: shows in the Studio, absent from the public site.
  once("design-notes-wip", () => {
    createArticle(db, {
      slug: "design-notes-wip",
      title: "Design Notes (WIP)",
      body: "# Design Notes\n\nRough thinking, not ready to publish.",
      tags: ["internal"],
    });
  });

  return { created, skipped };
}

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
  const { created, skipped } = seedDemo(db);
  sqlite.close();
  console.log(`Demo seed complete: ${created} created, ${skipped} already present.`);
}
