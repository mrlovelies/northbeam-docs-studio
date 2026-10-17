import { and, eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/src/db/client";
import {
  articles,
  articleVersions,
  type Article,
  type ArticleVersion,
} from "@/src/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

export interface CreateArticleInput {
  slug: string;
  title: string;
  body: string;
  tags: string[];
}

export interface UpdateDraftInput {
  title?: string;
  body?: string;
  tags?: string[];
  /** The draft_version the writer last read; the compare-and-set token (INV-5). */
  expectedVersion: number;
}

function isSlugConflict(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed: articles\.slug/.test(e.message);
}

// Create a new article as an unpublished draft.
export function createArticle(db: DrizzleDb, input: CreateArticleInput): Article {
  if (!input.slug?.trim()) throw new ValidationError("slug is required");
  if (!input.title?.trim()) throw new ValidationError("title is required");

  try {
    return db
      .insert(articles)
      .values({
        slug: input.slug,
        draftTitle: input.title,
        draftBody: input.body ?? "",
        draftTags: input.tags ?? [],
      })
      .returning()
      .get();
  } catch (e) {
    if (isSlugConflict(e)) {
      throw new ConflictError("slug_taken", `slug "${input.slug}" is already in use`);
    }
    throw e;
  }
}

// Fetch one article (draft + publication state). 404 if absent.
export function getArticle(db: DrizzleDb, id: string): Article {
  const row = db.select().from(articles).where(eq(articles.id, id)).get();
  if (!row) throw new NotFoundError(`article ${id} not found`);
  return row;
}

// List all articles (writer view).
export function listArticles(db: DrizzleDb): Article[] {
  return db.select().from(articles).all();
}

// Edit the draft. INV-5: the compare-and-set lives in the WHERE clause, so a
// stale write matches zero rows and loses; a missing token is refused outright.
export function updateDraft(db: DrizzleDb, id: string, input: UpdateDraftInput): Article {
  if (input.expectedVersion === undefined || input.expectedVersion === null) {
    throw new ValidationError("expectedVersion is required for a draft write");
  }

  const result = db
    .update(articles)
    .set({
      ...(input.title !== undefined ? { draftTitle: input.title } : {}),
      ...(input.body !== undefined ? { draftBody: input.body } : {}),
      ...(input.tags !== undefined ? { draftTags: input.tags } : {}),
      draftVersion: sql`${articles.draftVersion} + 1`,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(articles.id, id), eq(articles.draftVersion, input.expectedVersion)))
    .run();

  if (result.changes === 0) {
    // Zero rows changed: the article is gone, or the token was stale.
    const current = db.select().from(articles).where(eq(articles.id, id)).get();
    if (!current) throw new NotFoundError(`article ${id} not found`);
    throw new ConflictError("version_conflict", "draft is out of date", {
      current: current.draftVersion,
    });
  }

  return getArticle(db, id);
}

// Publish the current draft as the next immutable version, atomically (INV-2).
// One IMMEDIATE transaction: compute the next version number inside the lock,
// insert a copy of the draft (the copy is what makes INV-1 hold), then flip
// status + pointer + publishedAt. A crash or a racing publish can only leave the
// article fully before or fully after; UNIQUE(article_id, version_number) turns
// a numbering race into a rollback. publishedAt is set once, never recomputed
// (INV-6).
export function publish(db: DrizzleDb, id: string): ArticleVersion {
  return db.transaction(
    (tx) => {
      const article = tx.select().from(articles).where(eq(articles.id, id)).get();
      if (!article) throw new NotFoundError(`article ${id} not found`);

      const row = tx
        .select({
          max: sql<number>`coalesce(max(${articleVersions.versionNumber}), 0)`,
        })
        .from(articleVersions)
        .where(eq(articleVersions.articleId, id))
        .get();
      const nextNumber = (row?.max ?? 0) + 1;
      const now = new Date().toISOString();

      const version = tx
        .insert(articleVersions)
        .values({
          articleId: id,
          versionNumber: nextNumber,
          title: article.draftTitle,
          body: article.draftBody,
          tags: article.draftTags,
        })
        .returning()
        .get();

      tx.update(articles)
        .set({
          status: "published",
          currentPublishedVersionId: version.id,
          publishedAt: sql`coalesce(${articles.publishedAt}, ${now})`,
          updatedAt: now,
        })
        .where(eq(articles.id, id))
        .run();

      return version;
    },
    { behavior: "immediate" },
  );
}
