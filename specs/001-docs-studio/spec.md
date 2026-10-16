# Feature Specification: Northbeam Docs Studio

**Feature Directory**: `specs/001-docs-studio`

**Created**: 2026-10-15

**Status**: Draft

**Input**: A small internal docs CMS. Writers create, edit, publish, unpublish,
and version articles; anonymous readers see only published content.

## What we're building

Northbeam writers author documentation articles for a public docs site. An
article holds two separate things: a mutable **draft** the writer edits freely,
and a list of immutable **published versions**. Readers only ever read a
published version, never the draft.

Publishing the draft creates a numbered, frozen snapshot (a version) and points
the article at it. The writer can keep editing the draft afterward without
touching what readers see, until they publish again and mint the next version.
They can list history, view any old version, restore one back into the draft,
unpublish, and republish.

## The six invariants

- **INV-1 - Published content is frozen.** Once a version is published its title,
  body, and tags never change. Every edit goes through the draft and only reaches
  readers on the next publish, which mints a new version.
- **INV-2 - Publish is atomic.** Snapshotting the draft, flipping status to
  published, and moving the live pointer happen as one unit. There is no moment,
  even under a crash or a concurrent request, where status says published but the
  pointer is null or stale, or a snapshot exists that the article never points to.
- **INV-3 - The live version can't be deleted.** You cannot delete the version an
  article currently points at. The API rejects it, not just the UI. An
  unpublished article still points at its last snapshot, so that one stays
  protected too.
- **INV-4 - Restore is non-destructive.** Restoring an old version copies its
  content into the draft and nothing else: no version created, none removed,
  status and pointer untouched, and it does not publish.
- **INV-5 - Concurrent edits don't clobber.** If two sessions edit the same draft
  from the same starting point, the first save wins and the second is rejected as
  stale with a clear error. No accepted edit is silently overwritten.
- **INV-6 - Unpublish preserves.** Unpublishing only changes status. The last
  published snapshot and the original publishedAt survive, and republishing keeps
  that original publishedAt.

## Functional requirements

**Authoring (writer side, single trusted user, no auth)**

- Create an article with a title, a unique slug, a Markdown body, and tags; it
  starts as an unpublished draft. [INV-1]
- Edit the draft's title, body, and tags at any time, including after publishing,
  without changing what readers see. [INV-1]
- Every draft write (edit and restore) carries the draft version the writer last
  read. A stale write is rejected, and a write that omits the version marker is
  rejected rather than applied blind. [INV-5]
- Publish the draft: snapshot it as the next numbered version, mark the article
  published, point it at the new version, and set publishedAt on the first
  publish only (never recomputed after). [INV-1, INV-2, INV-6]
- Unpublish: a status change only. Readers lose access; versions and publishedAt
  are kept. Unpublishing an article that was never published is rejected. [INV-6]
- List an article's versions newest-first, and view any single version's exact
  content. [INV-1]
- Restore a chosen version's content into the draft without publishing it. [INV-4]
- Delete a non-live version. Deleting the live version is rejected by the API.
  [INV-3]

**Reading (public side, anonymous)**

- List published articles with title, tags, and published date. Draft-only and
  unpublished articles do not appear. [INV-1]
- View one published article rendered from its live version, never from the
  draft, even if the draft has moved on since. [INV-1]
- A draft-only or unpublished article returns 404, not an error and not draft
  content. [INV-1]

## Edge cases and decisions

- **Delete the live version** is refused, including when the article is
  unpublished (it still references that snapshot).
- **Deleting a non-live version** leaves gaps in version numbers. That is
  expected; we do not renumber.
- **Restore then publish** mints a fresh, next-numbered version from the draft.
  It does not revive or overwrite the version it was restored from.
- **Publishing an unchanged draft** still creates a new version by default, so
  unpublish then republish with no edit produces an identical-content version.
  Idempotent publish (the one candidate stretch) would change this; out of scope
  for v1.
- **404 for readers** is returned for unknown, draft-only, and unpublished
  articles alike, so we do not leak whether an unpublished article exists.
- **Concurrent publishes** of one article must not produce two versions sharing a
  number.
- Data must survive a restart (a real DB, not in-memory only).

## Out of scope

Per the brief, deliberately not building: auth / roles / multi-tenant scoping;
rich Markdown directives or a WYSIWYG editor (a textarea plus rendered preview is
enough); file and media uploads; search; scale pagination; caching; and
deployment / CI. Of the four optional stretch goals, at most one (idempotent
publish) is a maybe; the rest (save-as-version, diff view, slug auto-suffix) are
left out so the core lifecycle lands correct and tested.
