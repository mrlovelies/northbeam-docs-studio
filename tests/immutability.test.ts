import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createArticle, updateDraft, getArticle, publish } from "@/src/domain/articles";
import { articleVersions } from "@/src/db/schema";
import { createTestDb } from "./helpers";

// INV-1: a published version is frozen. Editing the draft after publishing never
// changes the stored snapshot, never moves the pointer, and is not an implicit
// republish.

const t = createTestDb();
beforeEach(() => t.truncate());
afterAll(() => t.close());

describe("INV-1 published content is frozen", () => {
  it("editing the draft after publish leaves v1 byte-identical and still live", () => {
    const a = createArticle(t.db, { slug: "s", title: "Orig", body: "OrigBody", tags: ["a"] });
    const v1 = publish(t.db, a.id, a.draftVersion);

    updateDraft(t.db, a.id, {
      title: "Edited",
      body: "EditedBody",
      tags: ["b"],
      expectedVersion: getArticle(t.db, a.id).draftVersion,
    });

    // The stored v1 snapshot is unchanged.
    const storedV1 = t.db
      .select()
      .from(articleVersions)
      .where(eq(articleVersions.id, v1.id))
      .get()!;
    expect(storedV1.title).toBe("Orig");
    expect(storedV1.body).toBe("OrigBody");
    expect(storedV1.tags).toEqual(["a"]);

    // The article is still published, still pointing at v1 (no implicit republish).
    const after = getArticle(t.db, a.id);
    expect(after.status).toBe("published");
    expect(after.currentPublishedVersionId).toBe(v1.id);

    // The draft reflects the edit.
    expect(after.draftTitle).toBe("Edited");
  });
});
