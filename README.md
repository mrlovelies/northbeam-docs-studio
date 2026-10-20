# Northbeam Docs Studio

A small internal docs CMS. Writers draft, publish, unpublish, and version
articles; anonymous readers see only published content. Built spec-first: the
spec, plan, and tasks live in `specs/001-docs-studio/`.

## Run

Prerequisites: Node 24. `better-sqlite3` is a native module. It ships prebuilt
binaries for common platforms, so `npm install` normally needs no build
toolchain; if it does build from source, you need a C/C++ compiler and Python
3.8 or newer (node-gyp).

```bash
npm install
npm run setup   # migrate + seed demo content (idempotent, safe to re-run)
npm test        # 26 invariant + behavior tests
npm run dev     # http://localhost:3000
```

`npm run dev` serves both surfaces: `/studio` (authoring) and `/` (public docs).

## What's built

- Writer API: create, list, get, edit draft, publish, unpublish, list and get
  versions, restore, delete version.
- Public API: list published, read by slug (rendered from the live version; 404
  for anything not published, so existence never leaks).
- A minimal Tailwind UI over both.

All invariant logic lives in `src/domain/` (a plain TypeScript service over
Drizzle). Route handlers in `app/api/` are thin adapters. Tests call the service
directly against a real temporary SQLite file.

## Data model

Two tables, and the split is the whole design.

- **`articles`** holds the mutable **draft** as plain columns (`draft_title`,
  `draft_body`, `draft_tags`, `draft_version`), plus `status`, `published_at`,
  and `current_published_version_id`: a nullable pointer to the live version.
- **`article_versions`** holds the published history as **immutable rows**
  (`version_number`, `title`, `body`, `tags`), one row per publish.

A reader reaches content only through the pointer, never the draft columns.
Publishing copies the draft into a new version row and moves the pointer; editing
the draft afterward never changes what readers see, until the next publish mints
the next version. The columns matter, but the **constraints are what enforce the
guarantees** (below), so they hold even when the API is called directly rather
than through the UI.

## The six invariants

Each is enforced server-side (service plus a DB constraint) and proved by a test
that attempts the violation and asserts it is rejected.

| # | Invariant | Enforcement | Proved by |
|---|---|---|---|
| INV-1 | Published versions are frozen | insert-only `article_versions` plus a `BEFORE UPDATE ... RAISE(ABORT)` trigger; readers read through the pointer | `immutability.test.ts` (edit after publish; raw `UPDATE` aborts), `public-reader.test.ts` |
| INV-2 | Publish is atomic | one `BEGIN IMMEDIATE` transaction; `CHECK (published implies pointer not null)`; `UNIQUE (article_id, version_number)` | `publish.test.ts` (status iff pointer set iff version row exists) |
| INV-3 | The live version cannot be deleted | service pre-check returns 409; FK `ON DELETE RESTRICT` is the backstop (and it protects the pointer while unpublished too) | `delete-version.test.ts` (incl. a raw delete refused by the FK) |
| INV-4 | Restore is non-destructive | a single draft `UPDATE`; no version created or removed, no status or pointer change, no publish | `restore.test.ts` |
| INV-5 | Concurrent edits do not clobber | conditional `UPDATE ... WHERE draft_version = ?` (compare-and-set); missing token is 400, stale token is 409 | `concurrency.test.ts`, publish token in `publish.test.ts` |
| INV-6 | Unpublish preserves | status-only change; `published_at` set once via `COALESCE`; pointer and version rows kept | `unpublish.test.ts` |

`PRAGMA foreign_keys = ON` is set per connection (SQLite has it off by default),
so the FK backstop for INV-3 is actually live rather than silently inert.

### A note on atomicity (INV-2)

Atomicity is proved by the biconditional (status = published iff the pointer is
set iff a version row exists) plus the single-transaction structure: because
better-sqlite3 transactions are synchronous, the only observable states are
fully-before or fully-after. A mid-transaction fault-injection test (interrupt
the transaction between the snapshot insert and the pointer update, then assert a
full rollback) would prove it more directly, but `publish()` exposes no injection
point for that without contorting the code, so it is left as a reasonable next
test to add. `UNIQUE (article_id, version_number)` turns a concurrent-publish
numbering race into a rollback rather than a duplicate.

## One tradeoff

Tags are stored as a JSON column, not a normalized join table. That is fine at
this scale and keeps each published snapshot self-contained; at scale (filtering
or searching by tag) I would normalize into a tags table. It compromises no
invariant. (Separately: publishing an unchanged draft still mints a new version.
Accepted for v1; idempotent publish was the one candidate stretch goal, left
out.)

## Project layout

```
specs/001-docs-studio/   spec.md, plan.md, tasks.md (the SDD artifacts)
src/domain/              articles service (all invariant logic), typed errors
src/db/                  schema, migrations + immutability trigger, connection, seed
app/api/                 thin route handlers (writer + public)
app/studio, app/read     minimal Tailwind UI (authoring + public read)
tests/                   one file per invariant, named by what it proves
tooling/                 the spec-first gate (see below)
```

## A note on process

The `tooling/` folder holds a small spec-first gate I ran this project under.
It blocks any implementation code until the spec, plan, and tasks are each
committed, so the AI agent I paired with couldn't jump ahead to code before the
thinking was written down and reviewed. It enforces that one ordering rule and
nothing else: no opinion on the stack, the layout, or how anything gets built.

It isn't part of the product, and it's meant to be liftable, the scripts plus a
couple of hooks, pointed at any repo's spec folder by one config file. I built
it because spec-first only really holds under pressure if something keeps you
honest, and this is how I like to keep an AI agent honest.
