// Data model for Northbeam Docs Studio.
//
// The split is the whole design: an article holds its mutable DRAFT as columns,
// and its published history as immutable rows in article_versions. A nullable
// pointer (current_published_version_id) names the live version readers see.
//
// Constraints here enforce invariants structurally:
//   - FK current_published_version_id ... ON DELETE RESTRICT  -> INV-3 (live version undeletable)
//   - CHECK (published => pointer not null)                   -> INV-2 (no half-published state)
//   - UNIQUE (article_id, version_number)                     -> INV-2 (no duplicate version numbers)
// INV-1's immutability trigger and the PRAGMAs (foreign_keys, WAL) can't be
// expressed in a Drizzle schema; they are applied in the migration (T007).

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  unique,
  index,
  check,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

const nowIso = () => new Date().toISOString();

export const articles = sqliteTable(
  "articles",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    slug: text("slug").notNull().unique(),
    status: text("status", { enum: ["draft", "published", "unpublished"] })
      .notNull()
      .default("draft"),
    draftTitle: text("draft_title").notNull(),
    draftBody: text("draft_body").notNull(),
    draftTags: text("draft_tags", { mode: "json" }).$type<string[]>().notNull(),
    // Optimistic lock: a draft write must present the version it read (INV-5).
    draftVersion: integer("draft_version").notNull().default(1),
    // Live snapshot pointer. ON DELETE RESTRICT is the DB backstop for INV-3.
    currentPublishedVersionId: text("current_published_version_id").references(
      (): AnySQLiteColumn => articleVersions.id,
      { onDelete: "restrict" },
    ),
    // First-ever publish time; set once, never recomputed (INV-6).
    publishedAt: text("published_at"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    updatedAt: text("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    check(
      "articles_status_values",
      sql`${t.status} in ('draft', 'published', 'unpublished')`,
    ),
    // INV-2: a published article can never point at nothing.
    check(
      "articles_published_has_pointer",
      sql`${t.status} <> 'published' or ${t.currentPublishedVersionId} is not null`,
    ),
  ],
);

export const articleVersions = sqliteTable(
  "article_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    articleId: text("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // INV-2: version numbers are unique per article; a racing publish rolls back.
    unique("article_versions_article_version_unq").on(
      t.articleId,
      t.versionNumber,
    ),
    // Serves history "newest first" (SQLite scans the composite index in reverse).
    index("article_versions_article_version_idx").on(
      t.articleId,
      t.versionNumber,
    ),
  ],
);

export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type ArticleVersion = typeof articleVersions.$inferSelect;
export type NewArticleVersion = typeof articleVersions.$inferInsert;
