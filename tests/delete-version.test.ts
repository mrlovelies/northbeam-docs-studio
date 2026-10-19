import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  createArticle,
  updateDraft,
  publish,
  unpublish,
  deleteVersion,
  getArticle,
} from "@/src/domain/articles";
import { ConflictError, NotFoundError } from "@/src/domain/errors";
import { articleVersions } from "@/src/db/schema";
import { createTestDb } from "./helpers";

// INV-3: the version an article currently points at cannot be deleted. The
// service rejects it with 409 (and the row stays); a non-live version deletes
// cleanly and the surviving numbers are not renumbered. An unpublished article
// still points at its last snapshot, so that one is protected too. The FK
// ON DELETE RESTRICT is the authoritative backstop beneath the service check.

const t = createTestDb();
beforeEach(() => t.truncate());
afterAll(() => t.close());

const versionsOf = (id: string) =>
  t.db.select().from(articleVersions).where(eq(articleVersions.articleId, id)).all();

// Edit then publish, returning the new version (used to build up history).
function publishNext(id: string, title: string) {
  updateDraft(t.db, id, { title, expectedVersion: getArticle(t.db, id).draftVersion });
  return publish(t.db, id, getArticle(t.db, id).draftVersion);
}

describe("INV-3 live version is undeletable", () => {
  it("rejects deleting the live version with 409 and keeps the row", () => {
    const a = createArticle(t.db, { slug: "s", title: "One", body: "B", tags: [] });
    const v1 = publish(t.db, a.id, a.draftVersion);

    let err: unknown;
    try {
      deleteVersion(t.db, a.id, v1.id);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("live_version");
    expect(versionsOf(a.id)).toHaveLength(1);
  });

  it("protects the live snapshot even when the article is unpublished", () => {
    const a = createArticle(t.db, { slug: "s2", title: "One", body: "B", tags: [] });
    const v1 = publish(t.db, a.id, a.draftVersion);
    unpublish(t.db, a.id);

    let err: unknown;
    try {
      deleteVersion(t.db, a.id, v1.id);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("live_version");
    expect(versionsOf(a.id)).toHaveLength(1);
  });

  it("deletes a non-live version and does not renumber the survivors", () => {
    const a = createArticle(t.db, { slug: "s3", title: "One", body: "B", tags: [] });
    const v1 = publish(t.db, a.id, a.draftVersion); // v1
    publishNext(a.id, "Two"); // v2
    const v3 = publishNext(a.id, "Three"); // v3, now live

    deleteVersion(t.db, a.id, v1.id); // v1 is non-live

    expect(versionsOf(a.id).map((v) => v.versionNumber).sort()).toEqual([2, 3]); // gap at 1
    expect(getArticle(t.db, a.id).currentPublishedVersionId).toBe(v3.id);
  });

  it("404s when the version does not belong to the article", () => {
    const a = createArticle(t.db, { slug: "s4", title: "One", body: "B", tags: [] });
    publish(t.db, a.id, a.draftVersion);
    let err: unknown;
    try {
      deleteVersion(t.db, a.id, "no-such-version");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it("FK ON DELETE RESTRICT is the backstop: a raw delete of the live row is refused by the DB", () => {
    // Bypass the service and attempt the delete at the DB layer directly.
    const a = createArticle(t.db, { slug: "s5", title: "One", body: "B", tags: [] });
    const v1 = publish(t.db, a.id, a.draftVersion);

    expect(() =>
      t.db.delete(articleVersions).where(eq(articleVersions.id, v1.id)).run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(versionsOf(a.id)).toHaveLength(1);
  });
});
