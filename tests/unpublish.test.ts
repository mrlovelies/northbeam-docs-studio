import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createArticle, publish, unpublish, getArticle } from "@/src/domain/articles";
import { ConflictError } from "@/src/domain/errors";
import { articleVersions } from "@/src/db/schema";
import { createTestDb } from "./helpers";

// INV-6: unpublishing only changes status. The snapshot, the pointer, and the
// original publishedAt survive, so nothing published is lost; republishing keeps
// that original publishedAt. (Reader visibility on status is proven in T026.)

const t = createTestDb();
beforeEach(() => t.truncate());
afterAll(() => t.close());

const versionsOf = (id: string) =>
  t.db.select().from(articleVersions).where(eq(articleVersions.articleId, id)).all();

describe("INV-6 unpublish preserves", () => {
  it("is status-only: keeps the pointer, publishedAt, and version rows", () => {
    const a = createArticle(t.db, { slug: "s", title: "T", body: "B", tags: [] });
    const v1 = publish(t.db, a.id, a.draftVersion);
    const pubAt = getArticle(t.db, a.id).publishedAt;

    const after = unpublish(t.db, a.id);
    expect(after.status).toBe("unpublished");
    expect(after.currentPublishedVersionId).toBe(v1.id);
    expect(after.publishedAt).toBe(pubAt);
    expect(versionsOf(a.id)).toHaveLength(1);
  });

  it("rejects unpublishing an article that was never published (409)", () => {
    const a = createArticle(t.db, { slug: "s2", title: "T", body: "B", tags: [] });
    let err: unknown;
    try {
      unpublish(t.db, a.id);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("not_published");
  });

  it("republish after unpublish restores published status with the original publishedAt", () => {
    const a = createArticle(t.db, { slug: "s3", title: "T", body: "B", tags: [] });
    publish(t.db, a.id, a.draftVersion);
    const originalPubAt = getArticle(t.db, a.id).publishedAt;

    unpublish(t.db, a.id);
    const republished = publish(t.db, a.id, getArticle(t.db, a.id).draftVersion);

    const after = getArticle(t.db, a.id);
    expect(after.status).toBe("published");
    expect(after.publishedAt).toBe(originalPubAt);
    expect(republished.versionNumber).toBe(2);
  });
});
