import { and, desc, eq, sql } from "drizzle-orm";
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

// List an article's version history, newest-first (INV-1). 404 if the article
// is absent, so the caller never gets an empty list for a nonexistent article.
export function listVersions(db: DrizzleDb, id: string): ArticleVersion[] {
  getArticle(db, id);
  return db
    .select()
    .from(articleVersions)
    .where(eq(articleVersions.articleId, id))
    .orderBy(desc(articleVersions.versionNumber))
    .all();
}

// Fetch one version's exact content (INV-1). 404 unless the version exists and
// belongs to this article.
export function getVersion(db: DrizzleDb, id: string, versionId: string): ArticleVersion {
  const row = db
    .select()
    .from(articleVersions)
    .where(and(eq(articleVersions.id, versionId), eq(articleVersions.articleId, id)))
    .get();
  if (!row) throw new NotFoundError(`version ${versionId} not found`);
  return row;
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
export function publish(db: DrizzleDb, id: string, expectedVersion: number): ArticleVersion {
  if (expectedVersion === undefined || expectedVersion === null) {
    throw new ValidationError("expectedVersion is required to publish");
  }
  return db.transaction(
    (tx) => {
      const article = tx.select().from(articles).where(eq(articles.id, id)).get();
      if (!article) throw new NotFoundError(`article ${id} not found`);
      // INV-5: don't snapshot a draft that moved under the writer.
      if (article.draftVersion !== expectedVersion) {
        throw new ConflictError("version_conflict", "draft is out of date", {
          current: article.draftVersion,
        });
      }

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

// Restore a version's content into the draft (INV-4). This is a draft write: it
// copies title/body/tags from the chosen version into draft_*, bumps the
// optimistic-lock token, and does nothing else: no version created or removed,
// no status or pointer change, no publish. The token is required and checked the
// same way as any draft edit (INV-5).
export function restore(
  db: DrizzleDb,
  id: string,
  versionId: string,
  expectedVersion: number,
): Article {
  if (expectedVersion === undefined || expectedVersion === null) {
    throw new ValidationError("expectedVersion is required to restore");
  }
  const version = getVersion(db, id, versionId); // 404 unless it belongs to the article

  const result = db
    .update(articles)
    .set({
      draftTitle: version.title,
      draftBody: version.body,
      draftTags: version.tags,
      draftVersion: sql`${articles.draftVersion} + 1`,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(articles.id, id), eq(articles.draftVersion, expectedVersion)))
    .run();

  if (result.changes === 0) {
    const current = db.select().from(articles).where(eq(articles.id, id)).get();
    if (!current) throw new NotFoundError(`article ${id} not found`);
    throw new ConflictError("version_conflict", "draft is out of date", {
      current: current.draftVersion,
    });
  }
  return getArticle(db, id);
}

// Unpublish: a status-only takedown (INV-6). Keeps the pointer, publishedAt, and
// every version row, so what was published is never lost. Republishing is simply
// publish() again, which preserves the original publishedAt via COALESCE.
export function unpublish(db: DrizzleDb, id: string): Article {
  const article = getArticle(db, id);
  if (article.status !== "published") {
    throw new ConflictError("not_published", "article is not currently published");
  }
  db.update(articles)
    .set({ status: "unpublished", updatedAt: new Date().toISOString() })
    .where(eq(articles.id, id))
    .run();
  return getArticle(db, id);
}

// Delete a non-live version (INV-3). The version an article currently points at
// cannot be deleted: the service pre-checks and returns a clean 409, and the FK
// ON DELETE RESTRICT is the authoritative backstop (it also closes the
// check-then-delete race). An unpublished article still points at its last
// snapshot, so that one is protected too.
export function deleteVersion(db: DrizzleDb, id: string, versionId: string): void {
  const article = getArticle(db, id); // 404 if the article is absent
  const version = getVersion(db, id, versionId); // 404 unless it belongs to the article

  if (article.currentPublishedVersionId === version.id) {
    throw new ConflictError("live_version", "cannot delete the live version");
  }

  db.delete(articleVersions).where(eq(articleVersions.id, version.id)).run();
}
