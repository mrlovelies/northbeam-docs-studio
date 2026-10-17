import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createArticle, updateDraft, getArticle } from "@/src/domain/articles";
import { ConflictError, ValidationError } from "@/src/domain/errors";
import { createTestDb } from "./helpers";

// INV-5: concurrent edits to the same draft must not silently clobber. The
// compare-and-set is the conditional UPDATE; a stale write loses with a clear
// error, a write with no version token is refused rather than applied blind.

const t = createTestDb();
beforeEach(() => t.truncate());
afterAll(() => t.close());

describe("INV-5 optimistic concurrency", () => {
  it("first write wins, the stale second is rejected 409, retry after re-read succeeds", () => {
    const a = createArticle(t.db, { slug: "s", title: "T", body: "B", tags: [] });
    expect(a.draftVersion).toBe(1);

    // Two sessions both read version 1.
    const stale = a.draftVersion;

    // First write from v1 succeeds and bumps to v2.
    const first = updateDraft(t.db, a.id, { title: "First", expectedVersion: stale });
    expect(first.draftVersion).toBe(2);

    // Second write still presenting v1 is out of date.
    let err: unknown;
    try {
      updateDraft(t.db, a.id, { title: "Second", expectedVersion: stale });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("version_conflict");
    expect((err as ConflictError).details?.current).toBe(2);

    // The first writer's content is intact (no silent clobber).
    expect(getArticle(t.db, a.id).draftTitle).toBe("First");

    // Retrying after re-reading the current version succeeds.
    const second = updateDraft(t.db, a.id, { title: "Second", expectedVersion: 2 });
    expect(second.draftVersion).toBe(3);
    expect(getArticle(t.db, a.id).draftTitle).toBe("Second");
  });

  it("a draft write with no version token is refused (400), never applied blind", () => {
    const a = createArticle(t.db, { slug: "s2", title: "T", body: "B", tags: [] });
    let err: unknown;
    try {
      // @ts-expect-error omitting expectedVersion must be refused at runtime
      updateDraft(t.db, a.id, { title: "X" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect(getArticle(t.db, a.id).draftTitle).toBe("T");
  });
});
