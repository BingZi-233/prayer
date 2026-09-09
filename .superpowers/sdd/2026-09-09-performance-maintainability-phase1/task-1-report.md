# Task 1 report

## Changes

- Added `lib/app-context.ts` with `AppContext` and `getAppContext(env)`; configuration is read from the repository at `env.DB_PATH`, while business access follows the resolved `cfg.dbPath`.
- Added process-level `sharedRepo(path)` caching on top of `sharedDb(path)`.
- Migrated all API routes that previously assembled `sharedDb` + `Repo` + `getConfig` to use `getAppContext`, preserving payloads and status handling.
- Updated config/plugin route mocks and added context behavior tests covering same-path reuse and distinct config/business paths.

## Verification

- `pnpm vitest run tests/lib/app-context.test.ts` (initial red run: module not found, then green)
- `pnpm vitest run tests/lib/app-context.test.ts tests/lib/config/route.test.ts tests/lib/plugins/route.test.ts` — 3 files, 14 tests passed.
- `pnpm typecheck` — passed (`tsc --noEmit`).
- `git diff --check` — passed.

## Concerns

- No known functional concerns. Existing route helpers remain in a few files for compatibility, but handlers now obtain the app context directly once per operation.

## Review round 1 fixes

- Added a complete stable `getAppContext` mock to `plugins/id-route.test.ts`.
- Refactored plugin collection and id handlers so each operation resolves one context and passes its config snapshot through manager/reconfigure helpers.
- Removed dead `repo()` helpers from KB catch-all and OneBot admin routes.
- Strengthened context isolation test with a session write/read assertion proving business data lands in the resolved business database, not the config database.

Round 1 verification: `pnpm vitest run tests/lib` — 71 files, 778 tests passed; `pnpm typecheck` passed; `git diff --check` passed.
