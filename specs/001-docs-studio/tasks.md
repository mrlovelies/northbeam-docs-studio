# Tasks: Northbeam Docs Studio

**Spec**: `specs/001-docs-studio/spec.md` | **Plan**: `specs/001-docs-studio/plan.md` | **Date**: 2026-10-16

Organized by capability and tagged `[INV-x]` (this project's spine is the six
invariants, not separate user stories). Format: `[ ] Txxx [P?] [INV-x?] Description (\`path\`)`.
`[P]` = parallelizable (different files, no dependency on an unfinished task).

Test discipline: for each invariant, commit the test first (it fails, the behavior
does not exist yet), then commit the implementation that turns it green, so the
history proves test-before-code the way it proves spec-before-code. The interim
test commits are red by design and labelled pre-impl (e.g. `test: INV-2 atomicity,
pre-impl (T014)`); each slice ends green and the final state is green. Implementation
commits reference task + invariant, e.g. `(T017, INV-2)`.

## Phase 1: Setup

- [x] T001 Scaffold Next.js 16 app (App Router, TypeScript, `src/`) at repo root
- [x] T002 Add deps `better-sqlite3`, `drizzle-orm`, `react-markdown`; dev `drizzle-kit`, `vitest`, `tailwindcss` + `@tailwindcss/postcss`, `tsx`, and types (`package.json`)
- [x] T003 [P] Configure Tailwind v4, CSS-first: `postcss.config.mjs` with `@tailwindcss/postcss`, and `@import "tailwindcss"` in `app/globals.css` (no JS config)
- [x] T004 [P] Configure Vitest (`vitest.config.ts`)
- [x] T005 Add scripts `dev`, `setup` (migrate, idempotent), `test` (`package.json`)

## Phase 2: Foundational (blocks all capability work)

- [x] T006 [INV-1][INV-2][INV-3] Drizzle schema (`src/db/schema.ts`): `articles` (slug UNIQUE, status CHECK in draft|published|unpublished, draft_version INT, current_published_version_id nullable FK to article_versions.id ON DELETE RESTRICT, published_at, timestamps) and `article_versions` (article_id FK to articles.id ON DELETE CASCADE, version_number, title, body, tags; UNIQUE(article_id, version_number); INDEX(article_id, version_number DESC))
- [x] T007 [INV-1][INV-2] Migration (`src/db/migrate.ts`): `CHECK (status <> 'published' OR current_published_version_id IS NOT NULL)`, a `BEFORE UPDATE ... ABORT` trigger on `article_versions`, and `PRAGMA foreign_keys=ON; journal_mode=WAL; busy_timeout=5000`
- [x] T008 [P] Dev-safe DB singleton, one handle across Next hot-reload with PRAGMAs applied per connection (`src/db/client.ts`)
- [x] T009 [P] Typed domain errors mapped to HTTP status: NotFound 404, Conflict 409, Validation 400 (`src/domain/errors.ts`)
- [x] T010 Test harness: temp SQLite file, migrate-once + truncate-per-test, two-connection helper for concurrency (`tests/helpers.ts`)

## Phase 3: Create + edit draft [INV-5]

- [x] T011 [INV-5] Test (write first, must fail): two writes from the same `draft_version`, first 200, second 409; retry after re-read 200; missing token 400 (`tests/concurrency.test.ts`)
- [x] T012 [INV-5] Service `createArticle`, `getArticle`, `listArticles`, `updateDraft` (conditional `UPDATE ... WHERE id=? AND draft_version=?`; `changes===0` means conflict; missing token means validation error) (`src/domain/articles.ts`)
- [x] T013 [INV-5] Routes `POST`/`GET /api/articles`, `GET /api/articles/[id]`, `PUT /api/articles/[id]/draft`; map error classes to 400/404/409 (`app/api/articles/...`)

## Phase 4: Publish + unpublish [INV-1][INV-2][INV-6]

- [x] T014 [INV-2] Test (first): publish biconditional, status=published iff pointer set iff version row exists; republish gives v2, pointer moves, v1 retained (`tests/publish.test.ts`)
- [x] T015 [INV-1] Test (first): edit draft after publish, v1 content unchanged, reader still sees v1, status still published (`tests/immutability.test.ts`)
- [ ] T016 [INV-6] Test (first): unpublish gives reader 404, snapshot + published_at preserved; republish keeps original published_at; unpublish never-published gives 409 (`tests/unpublish.test.ts`)
- [x] T017 [INV-1][INV-2] Service `publish()` as one `BEGIN IMMEDIATE` transaction: compute next version number inside the lock, insert the immutable snapshot (copy of draft), set status + pointer + `published_at = COALESCE(published_at, now)` (`src/domain/articles.ts`)
- [ ] T018 [INV-6] Service `unpublish()`, status-only, reject if never published (`src/domain/articles.ts`)
- [ ] T019 [INV-1][INV-2][INV-6] Routes `POST /api/articles/[id]/publish` and `.../unpublish` (`app/api/articles/[id]/...`)

## Phase 5: Versions, history, restore, delete [INV-1][INV-3][INV-4]

- [ ] T020 [INV-4] Test (first): restore leaves version count + status + pointer unchanged and does not publish; restore-then-publish mints a new number (`tests/restore.test.ts`)
- [ ] T021 [INV-3] Test (first): delete live version gives 409 with the row still present and still served; delete non-live gives 204 with remaining numbers not renumbered (`tests/delete-version.test.ts`)
- [ ] T022 [INV-1] Service + routes: list versions newest-first, get one version (`src/domain/articles.ts`, `app/api/articles/[id]/versions/...`)
- [ ] T023 [INV-4] Service + route `restore()`: copy version content into draft, bump `draft_version`, carry the token; no version create/remove, no status/pointer change, no publish (`POST /api/articles/[id]/versions/[vid]/restore`)
- [ ] T024 [INV-3] Service + route `deleteVersion()`: pre-check rejects the live version with 409, FK `ON DELETE RESTRICT` is the backstop (`DELETE /api/articles/[id]/versions/[vid]`)

## Phase 6: Public reader path [INV-1]

- [ ] T025 [INV-1] Test (first): lists only published; single view renders the live snapshot, never the draft; 404 for draft-only, unpublished, or unknown slug (`tests/public-reader.test.ts`)
- [ ] T026 [INV-1] Service + routes: public list (title, tags, published date) and public view rendering from the live version via the pointer, gated on `status='published'` (`app/api/public/articles/route.ts`, `.../[slug]/route.ts`)

## Phase 7: UI (Tailwind; tiebreaker, kept minimal)

- [ ] T027 [P] Authoring UI: article list, editor form (title, slug, body, tags), publish/unpublish, history panel with restore (`app/(studio)/...`)
- [ ] T028 [P] Public read view: published list + article page rendering Markdown via `react-markdown` (`app/(public)/...`)

## Phase 8: Deliverables

- [ ] T029 Idempotent seed for `npm run setup`; verify a clean checkout runs `npm install && npm run setup && npm test` (`src/db/seed.ts`)
- [ ] T030 README: how to run, data model + why, one tradeoff, the 6-row invariant/enforcement/test traceability matrix, and the "Note on process" (`README.md`)
- [ ] T031 Pre-submit: `tooling/sdd-check.sh audit` green (no-squash), full suite green via a single `npm test`

## Dependencies

- Phase 1, then Phase 2, then Phases 3-6 (service layer). Within the service
  layer the order is create/edit (3), publish/unpublish (4), versions (5), reader
  (6); the reader path only needs publish done, so it can move earlier if useful.
- Phase 7 (UI) follows the API routes it drives. Phase 8 is last.
- Every invariant has at least one test task: INV-1 (T015, T025), INV-2 (T014),
  INV-3 (T021), INV-4 (T020), INV-5 (T011), INV-6 (T016).

## MVP

Phases 1-4 (create, edit, publish, with the concurrency, atomicity, and
immutability tests) are a demonstrable, invariant-backed core. Phases 5-6 complete
the lifecycle; Phase 7 is presentation.
