# Implementation Plan: Northbeam Docs Studio

**Spec**: `specs/001-docs-studio/spec.md` | **Date**: 2026-10-16 | **Status**: Draft

## Summary

An article keeps its **mutable draft as plain columns** and its **published
history as separate immutable rows**, bridged by a pointer to the current live
version. A reader query reaches the version rows through that pointer and never
touches the draft columns. Every invariant is enforced in a service layer over
the DB (with DB constraints as backstops), never in the UI, so the guarantees
hold when the API is called directly.

## Stack (decided)

- **Next.js 16 (App Router, TypeScript)** - one app, one `npm install`, API and
  minimal UI colocated.
- **SQLite via better-sqlite3** - a real file (not `:memory:`), persists across
  restarts, fully ACID. Its transactions are **synchronous**, so the publish
  transaction cannot interleave with another request.
- **Drizzle ORM + drizzle-kit** - SQL-first (auditable against the invariants),
  synchronous transactions, migrations without a codegen engine.
- **Vitest** - one command, imports the service layer, runs against a real temp
  SQLite file.
- **react-markdown** - satisfies "rendered preview," nothing more.
- **Tailwind CSS** - utility-first styling for a clean, presentable UI without
  hand-rolled CSS. Adds a config, not architecture; the UI surface stays small.

## Architecture

All invariant logic lives in `src/domain` (a plain TS service over Drizzle).
Route handlers are ~5-line adapters: parse input, call the service, map a typed
error class to an HTTP status. Tests call the service directly against a real DB.

```text
src/
  domain/        articles service (all invariant logic), typed errors
  db/            schema.ts (Drizzle), migrations, dev-safe connection singleton
app/
  api/           thin route handlers (writer + public)
  (ui)/          authoring UI (form, list, history) + public read view (Tailwind)
tests/           invariant tests (Vitest), named by the invariant they prove
```

## Data model

Two tables. The columns matter, but the **constraints are what enforce the
invariants**, so each is tagged.

**articles**: `id` (uuid PK), `slug` (UNIQUE), `status` (CHECK in
`draft|published|unpublished`), `draft_title`, `draft_body`, `draft_tags` (JSON
string; SQLite has no array type), `draft_version` (INT, optimistic lock),
`current_published_version_id` (nullable FK to `article_versions.id`), `published_at`
(nullable ISO), `created_at`, `updated_at`.

**article_versions**: `id` (uuid PK), `article_id` (FK to `articles.id`),
`version_number` (INT), `title`, `body`, `tags` (JSON snapshot), `created_at`.

Enforcing constraints:

- `current_published_version_id ... ON DELETE RESTRICT` -> the live version cannot
  be deleted while referenced **[INV-3]**
- `CHECK (status <> 'published' OR current_published_version_id IS NOT NULL)` ->
  the DB refuses a published row with a null pointer **[INV-2]** (no symmetric
  check: unpublished rows deliberately keep the pointer, per INV-6)
- `UNIQUE (article_id, version_number)` -> numbering integrity; a racing publish
  becomes a rollback, not a duplicate **[INV-2]**
- `article_versions` is insert-only + a `BEFORE UPDATE ... ABORT` trigger ->
  published snapshots cannot be mutated **[INV-1]**
- `article_versions.article_id ... ON DELETE CASCADE` -> deleting an article
  cleans up its history
- `INDEX (article_id, version_number DESC)` -> history listed newest-first cheaply

## API shape

Writer side (no auth, single trusted user):

| Method + path | Purpose | Key statuses |
|---|---|---|
| `POST /api/articles` | create draft | 400 missing field, 409 slug collision |
| `GET /api/articles` | list all (writer view) | 200 |
| `GET /api/articles/:id` | get one (draft + state) | 200, 404 |
| `PUT /api/articles/:id/draft` | edit draft (carries `expectedVersion`) | 200, 400 missing token, 409 stale |
| `POST /api/articles/:id/publish` | snapshot + go live | 200, 404 |
| `POST /api/articles/:id/unpublish` | status-only takedown | 200, 409 if never published |
| `GET /api/articles/:id/versions` | history, newest-first | 200 |
| `GET /api/articles/:id/versions/:vid` | one version's exact content | 200, 404 |
| `POST /api/articles/:id/versions/:vid/restore` | copy into draft (carries token) | 200, 409 stale |
| `DELETE /api/articles/:id/versions/:vid` | delete non-live version | 204, **409 if live** |

Public side (anonymous):

| Method + path | Purpose | Key statuses |
|---|---|---|
| `GET /api/public/articles` | published only (title, tags, date) | 200 |
| `GET /api/public/articles/:slug` | render from live version | 200, **404** if draft-only/unpublished/unknown |

Conventions: stale write and delete-live are both **409** (resource-state
conflict); reader on anything not published is **404** (never leak existence);
missing field or missing concurrency token is **400**. Public GETs stay dynamic
(no static caching a stale published list).

## Key design decisions (each tagged to its invariant)

- **D1 - Atomic publish is one synchronous transaction [INV-2, INV-1].**
  `BEGIN IMMEDIATE`, load the article, compute `next = max(version_number)+1`
  **inside** the lock, insert the immutable snapshot (a copy of the draft), then
  update the article's status + pointer + `published_at` in the same tx, commit.
  Because better-sqlite3 tx are synchronous, the only post-crash states are fully
  before or fully after. Copying (not referencing) the draft is what gives INV-1.
- **D2 - Optimistic concurrency is a conditional UPDATE [INV-5].**
  `UPDATE ... SET ..., draft_version = draft_version + 1 WHERE id = ? AND draft_version = ?`;
  inspect `changes` (1 = ok, 0 = conflict -> 409 with `{current}` so the client can
  diff). A missing token is a 400, never an unconditional write. No read-then-write
  in app memory.
- **D3 - Immutability has teeth [INV-1].** There is no UPDATE path to a version
  row in the service, and a `BEFORE UPDATE` trigger aborts one anyway (catches an
  ORM full-row save that review would miss). All editing goes through the draft.
- **D4 - Delete-live is refused twice [INV-3].** The service pre-checks and returns
  a clean 409; the FK `ON DELETE RESTRICT` is the authoritative backstop that also
  closes the check-then-delete TOCTOU window. An unpublished article still points
  at its last snapshot, so that snapshot stays undeletable (correct, per INV-6).
- **D5 - Restore writes only the draft [INV-4].** A single UPDATE copies the
  chosen version's content into `draft_*` and bumps `draft_version`; it never
  creates/removes versions, never moves the pointer or status, and does not
  publish. It carries the concurrency token like any draft write.
- **D6 - Unpublish is status-only [INV-6].** Set `status='unpublished'`; keep the
  pointer, the versions, and `published_at`. `published_at = COALESCE(published_at, now)`
  is set once on first publish and never recomputed. The reader gate is
  `status='published'`.
- **D7 - Every reader path reads through the pointer [INV-1].** Public list and
  public view both read `title`/`body` from the live version via
  `current_published_version_id`, never from `draft_*`. The reader gate is
  `status='published'`, not "has a pointer" (unpublished rows still hold one).

**SQLite notes:** `PRAGMA foreign_keys = ON` is per-connection
and off by default, so the app-layer 409 is the real contract and the FK is the
backstop; also `journal_mode = WAL` and `busy_timeout = 5000`, with a dev-safe
singleton DB handle so Next hot-reload doesn't open a pile of connections.

## Testing approach

Vitest against a real temp SQLite file, **migrate-once + truncate-per-test** (not
transaction-per-test: publish runs its own transaction and the concurrency test
needs two independent connections). `npm test` migrates then runs everything.
Each test is named by the invariant it proves and works by **attempting the
violation** and asserting rejection: edit-after-publish leaves v1 untouched; the
publish biconditional (status=published iff pointer set iff version row exists);
delete-live -> 409 and still served; restore leaves version count + state
unchanged; two stale writes -> first wins, second 409; unpublish/republish keeps
the original `published_at`.

## Tradeoffs

- **Tags as a JSON column, not a join table.** Fine at this scale and keeps the
  snapshot self-contained; at scale (filter/search by tag) I'd normalize into a
  tags table. Compromises no invariant.
- **Publish of an unchanged draft still mints a version** (so unpublish ->
  republish with no edit duplicates content). Accepted for v1; idempotent publish
  is the single candidate stretch, scoped out otherwise.
