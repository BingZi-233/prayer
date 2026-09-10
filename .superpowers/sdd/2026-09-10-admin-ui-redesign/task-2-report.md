# Task 2 report — login and monitoring pages

## Changed files

- `app/login/page.tsx` — refreshed the token login surface with the shared card language, branded header, accessible busy state, and a compact security note. The `/api/auth/login` request, redirect validation, toast feedback, and disabled-submit behavior are unchanged.
- `app/admin/page.tsx` — kept the LiveProvider status and restart flow intact, normalized unknown runtime states to `未知`, added shared loading/error/empty handling for model usage, and bounded the usage table's horizontal overflow.
- `app/admin/logs/page.tsx` — kept polling, filtering, virtual scrolling, expansion, copy, and pause behavior intact; added localized level labels and a responsive search control while retaining the explicit scroll viewport.
- `components/admin/data-state.tsx` — marked shared empty/error surfaces as polite status announcements for assistive technology.
- `tests/ui/admin-monitoring-contracts.test.ts` — focused render-contract coverage for login, runtime usage states, log labels/viewport, and accessible shared states.

## Preserved business semantics

- Authentication still posts the entered token to `/api/auth/login` and only redirects to an `/admin` path.
- Agent restart still posts to `/api/runtime/restart`, reports the same success/failure toasts, refreshes live status, and preserves the busy guard.
- Runtime status and overview remain sourced from `LiveProvider`; model usage remains a 30-second `usePolling` request to `/api/usage`.
- Logs remain fetched from `/api/logs`, filtered by the same level/query state, virtualized, expandable, copyable, pausable, and bounded to the existing in-memory retention behavior.

## Verification

- `pnpm vitest run tests/ui/admin-monitoring-contracts.test.ts` — PASS (4 tests).
- `pnpm vitest run tests/ui/admin-monitoring-contracts.test.ts tests/ui/admin-visual-contracts.test.ts` — PASS (2 files, 6 tests).
- `pnpm typecheck` — PASS.
- `git diff --check` — PASS.

## Unresolved risks

- The monitoring pages still depend on live API responses and the existing `LiveProvider`; no browser/runtime session was available in this focused task to validate remote data timing.
- Repository-wide `pnpm check` and production build remain final integration gates for the parent task.
