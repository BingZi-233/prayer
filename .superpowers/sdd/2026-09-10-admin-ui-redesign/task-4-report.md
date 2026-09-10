# Task 4 report — knowledge pages

## Changed files

- `app/admin/reflection/page.tsx` — per-group reflection progress table now uses `TableShell`; entry moderation, compaction diff loading, and promotion actions unchanged.
- `app/admin/ranking/page.tsx` — question ranking table now uses `TableShell` (771 rows in practice, so the capped scroll viewport and sticky header matter here); the 7d/30d/all window switch is unchanged.
- `app/admin/kb/page.tsx` — file-tree search moved to `InputGroup`; tree building, unsaved-change guard, save/ingest flows, and the mobile master-detail layout unchanged.
- `tests/ui/admin-knowledge-contracts.test.ts` — new contracts for the shared shell, the search input group, and the preserved save/ingest, moderation, and window-switch semantics.

## Preserved business semantics

- KB still saves through `PUT /api/kb/<path>`, rebuilds through `POST /api/kb/ingest`, tracks `dirtyDocs`, and keeps the unsaved-navigation and beforeunload guards.
- Reflection still uses `POST /api/reflection/compact`, `POST /api/reflection/promote`, and `PATCH /api/reflection` with `approve` / `reject` / `promote`.
- Ranking still polls `/api/ranking?window=…` at 30s.

## Verification

- `pnpm vitest run tests/ui/admin-knowledge-contracts.test.ts` — PASS (5 tests).
- `pnpm test` — PASS (89 files, 949 tests at time of commit).
- `pnpm typecheck` — PASS.
- Browser: `/admin/kb`, `/admin/reflection`, `/admin/ranking` at 390/768/1440 — no horizontal overflow; ranking renders a single `table-shell` with a sticky header; KB mobile flow (open file → detail → 返回文件列表 → list with search) verified at 390.

## Unresolved risks

- Ranking and reflection group labels depend on the live channel for name resolution; preview shows raw ids by design.
