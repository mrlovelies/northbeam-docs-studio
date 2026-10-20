import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createArticle, updateDraft, publish, getArticle } from "@/src/domain/articles";
import { ValidationError } from "@/src/domain/errors";
import { createTestDb } from "./helpers";

// Input-validation fidelity at the service boundary: malformed input is a 400
// (ValidationError), consistently across the draft writers and publish, and bad
// tags never reach a (frozen) version row.

const t = createTestDb();
beforeEach(() => t.truncate());
afterAll(() => t.close());

function caught(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

describe("input validation", () => {
  it("rejects a non-integer version token with 400, consistently on edit and publish", () => {
    const a = createArticle(t.db, { slug: "s", title: "T", body: "B", tags: [] });
    // @ts-expect-error token must be a number at runtime
    expect(caught(() => updateDraft(t.db, a.id, { title: "x", expectedVersion: "1" }))).toBeInstanceOf(ValidationError);
    // @ts-expect-error token must be a number at runtime
    expect(caught(() => publish(t.db, a.id, "1"))).toBeInstanceOf(ValidationError);
    // the rejected edit did not mutate the draft
    expect(getArticle(t.db, a.id).draftVersion).toBe(1);
  });

  it("rejects a garbage version token with 400, not a 409 conflict", () => {
    const a = createArticle(t.db, { slug: "s2", title: "T", body: "B", tags: [] });
    // @ts-expect-error token must be a number at runtime
    expect(caught(() => updateDraft(t.db, a.id, { title: "x", expectedVersion: "abc" }))).toBeInstanceOf(ValidationError);
    // @ts-expect-error token must be a number at runtime
    expect(caught(() => publish(t.db, a.id, "abc"))).toBeInstanceOf(ValidationError);
  });

  it("rejects tags that are not a string array, so garbage never freezes into a version", () => {
    // @ts-expect-error tags must be string[]
    expect(caught(() => createArticle(t.db, { slug: "s3", title: "T", body: "B", tags: "oops" }))).toBeInstanceOf(ValidationError);
    // @ts-expect-error tags must be string[]
    expect(caught(() => createArticle(t.db, { slug: "s4", title: "T", body: "B", tags: [1, 2] }))).toBeInstanceOf(ValidationError);
    const a = createArticle(t.db, { slug: "s5", title: "T", body: "B", tags: [] });
    // @ts-expect-error tags must be string[]
    expect(caught(() => updateDraft(t.db, a.id, { tags: [{ evil: true }], expectedVersion: a.draftVersion }))).toBeInstanceOf(ValidationError);
  });

  it("rejects a non-string title or slug with 400, not a 500", () => {
    // @ts-expect-error title must be a string
    expect(caught(() => createArticle(t.db, { slug: "s6", title: 123, body: "B", tags: [] }))).toBeInstanceOf(ValidationError);
    // @ts-expect-error slug must be a string
    expect(caught(() => createArticle(t.db, { slug: 123, title: "T", body: "B", tags: [] }))).toBeInstanceOf(ValidationError);
  });

  it("normalizes a slug to a URL-safe form (slugify) on create", () => {
    const cases: [string, string][] = [
      ["Testy Laroo", "testy-laroo"],
      ["Has  Spaces", "has-spaces"],
      ["UPPER Case", "upper-case"],
      ["already-good", "already-good"],
      ["  --trim--me--  ", "trim-me"],
    ];
    for (const [input, expected] of cases) {
      const a = createArticle(t.db, { slug: input, title: "T", body: "B", tags: [] });
      expect(a.slug).toBe(expected);
    }
  });

  it("rejects a slug with no URL-safe characters with 400", () => {
    expect(caught(() => createArticle(t.db, { slug: "!!!", title: "T", body: "B", tags: [] }))).toBeInstanceOf(ValidationError);
    expect(caught(() => createArticle(t.db, { slug: "   ", title: "T", body: "B", tags: [] }))).toBeInstanceOf(ValidationError);
  });
});
