import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createArticle, updateDraft, getArticle, publish } from "@/src/domain/articles";
import { ConflictError, ValidationError } from "@/src/domain/errors";
import { articles, articleVersions } from "@/src/db/schema";
import { createTestDb } from "./helpers";

// INV-2: publishing is atomic. Snapshot insert + status flip + pointer move
// happen as one unit, so the observable states are only "fully before" or
// "fully after": status=published iff a pointer is set iff a version row exists.

const t = createTestDb();
beforeEach(() => t.truncate());
afterAll(() => t.close());

const versionsOf = (id: string) =>
  t.db.select().from(articleVersions).where(eq(articleVersions.articleId, id)).all();

describe("INV-2 atomic publish", () => {
  it("couples status, pointer, and version row (the biconditional)", () => {
    const a = createArticle(t.db, { slug: "s", title: "T1", body: "B1", tags: ["x"] });

    const before = getArticle(t.db, a.id);
    expect(before.status).toBe("draft");
    expect(before.currentPublishedVersionId).toBeNull();
    expect(versionsOf(a.id)).toHaveLength(0);

    const v1 = publish(t.db, a.id, a.draftVersion);
    expect(v1.versionNumber).toBe(1);

    const after = getArticle(t.db, a.id);
    expect(after.status).toBe("published");
    expect(after.currentPublishedVersionId).toBe(v1.id);
    expect(after.publishedAt).not.toBeNull();
    const versions = versionsOf(a.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].id).toBe(v1.id);
  });

  it("republish mints v2, moves the pointer, retains v1, preserves publishedAt (INV-6)", () => {
    const a = createArticle(t.db, { slug: "s2", title: "T", body: "B", tags: [] });
    publish(t.db, a.id, a.draftVersion);
    const firstPublishedAt = getArticle(t.db, a.id).publishedAt;

    updateDraft(t.db, a.id, {
      title: "T2",
      expectedVersion: getArticle(t.db, a.id).draftVersion,
    });
    const v2 = publish(t.db, a.id, getArticle(t.db, a.id).draftVersion);

    expect(v2.versionNumber).toBe(2);
    const after = getArticle(t.db, a.id);
    expect(after.currentPublishedVersionId).toBe(v2.id);
    expect(after.publishedAt).toBe(firstPublishedAt);
    expect(versionsOf(a.id).map((v) => v.versionNumber).sort()).toEqual([1, 2]);
  });
});

describe("publish version token (INV-5)", () => {
  it("rejects a stale token with 409 and does not publish", () => {
    const a = createArticle(t.db, { slug: "s3", title: "T", body: "B", tags: [] });
    const stale = a.draftVersion;
    updateDraft(t.db, a.id, { title: "T2", expectedVersion: stale });

    let err: unknown;
    try {
      publish(t.db, a.id, stale);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("version_conflict");
    expect((err as ConflictError).details?.current).toBe(2);
    expect(getArticle(t.db, a.id).status).toBe("draft");
    expect(versionsOf(a.id)).toHaveLength(0);
  });

  it("rejects a missing token with 400", () => {
    const a = createArticle(t.db, { slug: "s4", title: "T", body: "B", tags: [] });
    let err: unknown;
    try {
      // @ts-expect-error omitting the token must be refused at runtime
      publish(t.db, a.id);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect(getArticle(t.db, a.id).status).toBe("draft");
  });

  it("publishes when the token matches the current draft", () => {
    const a = createArticle(t.db, { slug: "s5", title: "T", body: "B", tags: [] });
    const v1 = publish(t.db, a.id, a.draftVersion);
    expect(v1.versionNumber).toBe(1);
    expect(getArticle(t.db, a.id).status).toBe("published");
  });
});

// INV-2's atomicity rests on DB constraints: a published row must have a pointer
// (CHECK) and version numbers are unique per article (UNIQUE). These attack those
// backstops directly, so the suite goes red if either constraint is removed; the
// transaction's happy path is covered above.
describe("INV-2 backstops (the constraints have teeth)", () => {
  it("UNIQUE(article_id, version_number) rejects a duplicate version number", () => {
    const a = createArticle(t.db, { slug: "u1", title: "T", body: "B", tags: [] });
    const v1 = publish(t.db, a.id, a.draftVersion);
    // A racing publish that computed the same number would hit this and roll back.
    expect(() =>
      t.db
        .insert(articleVersions)
        .values({ articleId: a.id, versionNumber: v1.versionNumber, title: "dupe", body: "dupe", tags: [] })
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
    expect(versionsOf(a.id)).toHaveLength(1);
  });

  it("CHECK refuses a published row with no pointer (no half-published state)", () => {
    const a = createArticle(t.db, { slug: "u2", title: "T", body: "B", tags: [] });
    expect(() =>
      t.db.update(articles).set({ status: "published" }).where(eq(articles.id, a.id)).run(),
    ).toThrow(/CHECK constraint failed/);
    expect(getArticle(t.db, a.id).status).toBe("draft");
  });

  it("two independent connections publishing the same draft get distinct numbers, never a shared one", () => {
    const a = createArticle(t.db, { slug: "u3", title: "T", body: "B", tags: [] });
    const conn2 = t.openConnection();
    // publish() does not bump draft_version, so the same token is valid on both;
    // BEGIN IMMEDIATE serializes them, so they mint 1 then 2 (UNIQUE would reject a tie).
    const first = publish(t.db, a.id, a.draftVersion);
    const second = publish(conn2, a.id, a.draftVersion);
    expect([first.versionNumber, second.versionNumber].sort()).toEqual([1, 2]);
    expect(versionsOf(a.id).map((v) => v.versionNumber).sort()).toEqual([1, 2]);
  });
});
