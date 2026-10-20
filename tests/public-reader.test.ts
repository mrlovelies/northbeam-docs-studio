import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  createArticle,
  updateDraft,
  publish,
  unpublish,
  getArticle,
  listPublished,
  getPublished,
} from "@/src/domain/articles";
import { NotFoundError } from "@/src/domain/errors";
import { createTestDb } from "./helpers";

// INV-1 (reader side): the public path reads only through the live pointer,
// gated on status='published'. Readers see the frozen published snapshot, never
// the draft, even after the draft moves on. Draft-only, unpublished, and unknown
// slugs all 404 alike, so we never leak whether an unpublished article exists.

const t = createTestDb();
beforeEach(() => t.truncate());
afterAll(() => t.close());

describe("INV-1 public reader", () => {
  it("lists only currently-published articles", () => {
    createArticle(t.db, { slug: "draft-only", title: "D", body: "b", tags: [] });
    const pub = createArticle(t.db, { slug: "pub", title: "P", body: "b", tags: ["x"] });
    publish(t.db, pub.id, pub.draftVersion);
    const taken = createArticle(t.db, { slug: "taken-down", title: "T", body: "b", tags: [] });
    publish(t.db, taken.id, taken.draftVersion);
    unpublish(t.db, taken.id);

    expect(listPublished(t.db).map((a) => a.slug)).toEqual(["pub"]);
  });

  it("list shows the published snapshot's title/tags, not the moved-on draft", () => {
    const a = createArticle(t.db, { slug: "s", title: "Published Title", body: "b", tags: ["live"] });
    publish(t.db, a.id, a.draftVersion);
    updateDraft(t.db, a.id, {
      title: "Draft Title",
      tags: ["draft"],
      expectedVersion: getArticle(t.db, a.id).draftVersion,
    });

    const [row] = listPublished(t.db);
    expect(row.title).toBe("Published Title");
    expect(row.tags).toEqual(["live"]);
  });

  it("renders a single article from the live version, never the draft", () => {
    const a = createArticle(t.db, { slug: "post", title: "V1 Title", body: "V1 body", tags: ["a"] });
    publish(t.db, a.id, a.draftVersion);
    updateDraft(t.db, a.id, {
      title: "Edited",
      body: "Edited body",
      expectedVersion: getArticle(t.db, a.id).draftVersion,
    });

    const view = getPublished(t.db, "post");
    expect(view.title).toBe("V1 Title");
    expect(view.body).toBe("V1 body");
    expect(view.tags).toEqual(["a"]);
  });

  it("404s for draft-only, unpublished, and unknown slugs alike (no existence leak)", () => {
    createArticle(t.db, { slug: "only-draft", title: "D", body: "b", tags: [] });
    const u = createArticle(t.db, { slug: "was-up", title: "U", body: "b", tags: [] });
    publish(t.db, u.id, u.draftVersion);
    unpublish(t.db, u.id);

    for (const slug of ["only-draft", "was-up", "does-not-exist"]) {
      let err: unknown;
      try {
        getPublished(t.db, slug);
      } catch (e) {
        err = e;
      }
      expect(err, `slug ${slug}`).toBeInstanceOf(NotFoundError);
    }
  });
});
