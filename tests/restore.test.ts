import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  createArticle,
  updateDraft,
  publish,
  restore,
  getArticle,
} from "@/src/domain/articles";
import { ConflictError, NotFoundError, ValidationError } from "@/src/domain/errors";
import { articleVersions } from "@/src/db/schema";
import { createTestDb } from "./helpers";

// INV-4: restore copies a chosen version's content into the draft and nothing
// else. No version is created or removed, status and pointer are untouched, and
// it does not publish. Restore is a draft write, so it carries the optimistic
// lock token like any edit (INV-5).

const t = createTestDb();
beforeEach(() => t.truncate());
afterAll(() => t.close());

const versionsOf = (id: string) =>
  t.db.select().from(articleVersions).where(eq(articleVersions.articleId, id)).all();

describe("INV-4 restore is non-destructive", () => {
  it("copies version content into the draft, changing nothing else", () => {
    // v1 = "One", then edit the draft and publish v2 = "Two"; live is v2.
    const a = createArticle(t.db, { slug: "s", title: "One", body: "BodyOne", tags: ["a"] });
    const v1 = publish(t.db, a.id, a.draftVersion);
    updateDraft(t.db, a.id, {
      title: "Two",
      body: "BodyTwo",
      tags: ["b"],
      expectedVersion: getArticle(t.db, a.id).draftVersion,
    });
    const v2 = publish(t.db, a.id, getArticle(t.db, a.id).draftVersion);

    const before = getArticle(t.db, a.id);
    expect(before.currentPublishedVersionId).toBe(v2.id);
    expect(versionsOf(a.id)).toHaveLength(2);

    const after = restore(t.db, a.id, v1.id, before.draftVersion);

    // Draft now holds v1's content.
    expect(after.draftTitle).toBe("One");
    expect(after.draftBody).toBe("BodyOne");
    expect(after.draftTags).toEqual(["a"]);

    // Nothing else moved: status, pointer, publishedAt, version count unchanged.
    expect(after.status).toBe("published");
    expect(after.currentPublishedVersionId).toBe(v2.id);
    expect(after.publishedAt).toBe(before.publishedAt);
    expect(versionsOf(a.id)).toHaveLength(2);

    // It is a draft write, so it bumped the optimistic-lock token.
    expect(after.draftVersion).toBe(before.draftVersion + 1);
  });

  it("restore then publish mints a fresh next number, not a revival of the old one", () => {
    const a = createArticle(t.db, { slug: "s2", title: "One", body: "B1", tags: [] });
    const v1 = publish(t.db, a.id, a.draftVersion);
    updateDraft(t.db, a.id, { title: "Two", expectedVersion: getArticle(t.db, a.id).draftVersion });
    publish(t.db, a.id, getArticle(t.db, a.id).draftVersion); // v2

    restore(t.db, a.id, v1.id, getArticle(t.db, a.id).draftVersion);
    const v3 = publish(t.db, a.id, getArticle(t.db, a.id).draftVersion);

    expect(v3.versionNumber).toBe(3);
    expect(v3.title).toBe("One"); // content came from the restored draft
    expect(versionsOf(a.id).map((v) => v.versionNumber).sort()).toEqual([1, 2, 3]);
  });

  it("rejects a stale token with 409 and leaves the draft untouched", () => {
    const a = createArticle(t.db, { slug: "s3", title: "One", body: "B1", tags: [] });
    const v1 = publish(t.db, a.id, a.draftVersion);
    const stale = getArticle(t.db, a.id).draftVersion;
    updateDraft(t.db, a.id, { title: "Two", expectedVersion: stale }); // draft moves on

    let err: unknown;
    try {
      restore(t.db, a.id, v1.id, stale);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("version_conflict");
    expect(getArticle(t.db, a.id).draftTitle).toBe("Two");
  });

  it("rejects a missing token with 400", () => {
    const a = createArticle(t.db, { slug: "s4", title: "One", body: "B1", tags: [] });
    const v1 = publish(t.db, a.id, a.draftVersion);
    let err: unknown;
    try {
      // @ts-expect-error omitting the token must be refused at runtime
      restore(t.db, a.id, v1.id);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
  });

  it("404s when the version does not belong to the article", () => {
    const a = createArticle(t.db, { slug: "s5", title: "One", body: "B1", tags: [] });
    publish(t.db, a.id, a.draftVersion);
    let err: unknown;
    try {
      restore(t.db, a.id, "no-such-version", getArticle(t.db, a.id).draftVersion);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NotFoundError);
  });
});
