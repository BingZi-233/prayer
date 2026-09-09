# Base UI migration project

2026-09-09, whole-project finalization after Tasks 3–10 (Base UI 1.6.0, `base-mira`)
— verdict: all 16 scoped wrappers and their consumers use Base UI; no Radix source imports remain.

## Changed

### Dependency and shadcn configuration

- `components.json`: changed `style` from `radix-mira` to `base-mira` (confirmed by `npx shadcn@latest info --json`, which reports `base: "base"`).
- `package.json` / `pnpm-lock.yaml`: removed the direct `radix-ui` dependency with `pnpm remove radix-ui`. No unrelated dependency entries changed.
- `@base-ui/react` remains pinned at `1.6.0`.
- `tests/ui/base-ui-contracts.test.ts` now guards every direct dependency key (`radix-ui` and all `@radix-ui/*`) and recursively parses every `.ts`/`.tsx` file under `components`, `app`, and `lib` with the TypeScript AST. It only reports import/export/require/dynamic-import module specifiers, not report text or ordinary `data-[state]` classes.

### Wrapper status (16/16 migrated)

`alert-dialog`, `badge`, `bubble`, `button`, `checkbox`, `dialog`, `label`, `popover`, `scroll-area`, `select`, `separator`, `sheet`, `sidebar`, `switch`, `tabs`, and `tooltip` all import Base UI (or native elements for Label) and contain no `radix-ui`, `@radix-ui`, `Slot`, or `asChild` references.

### Consumer sweep

- Removed the three stale `data-[state=inactive]:hidden` selectors from `app/admin/kb/page.tsx`; Base Tabs panels provide hidden/unmount semantics.
- Reviewed both AlertDialog instances in `app/admin/sessions/page.tsx` and the delete/discard dialogs in `app/admin/kb/page.tsx`; they use the migrated controlled boolean API and require no prop changes.
- The source sweep command and result:

```text
$ rg -n "radix-ui|@radix-ui|Slot|asChild|data-\[state=" components app lib --glob '*.{ts,tsx}'
components/ui/table.tsx:60: data-[state=selected]:bg-muted
components/ui/sidebar.tsx:310: peer-data-[state=collapsed]:ml-2
```

The two remaining `data-[state=...]` matches are ordinary table/sidebar state styling, not Radix selectors. There are no source matches for `radix-ui`, `@radix-ui`, `Slot`, or `asChild`.

## Left alone

- `cmdk`, `sonner`, `react-markdown`, and `message-scroller` were intentionally preserved. `cmdk@1.1.1` brings several `@radix-ui/*` packages transitively in the lockfile; these are not direct project dependencies or migrated wrappers.
- Non-Radix UI wrappers (`card`, `command`, `empty`, `field`, `input`, `input-group`, `input`, `message`, `skeleton`, `sonner`, `spinner`, `table`, `textarea`) were not rewritten.
- Admin business logic, API calls, authentication, navigation routes, dialog copy, and session actions were unchanged.

## Behavior changes

- Tabs use Base UI's default manual keyboard activation; the former Radix `activationMode` option is not forwarded.
- `PopoverAnchor` is an inert passthrough because Base UI 1.6.0 has no Anchor part.
- Tooltip's compatibility `delayDuration` maps to Base `delay`; `disableHoverableContent` has no Base equivalent and is not forwarded.
- Select controlled callbacks can emit `null`; consumers now ignore `null` where the existing domain state has no empty value.
- Label, Separator, Checkbox, and Switch use native/Base state attributes (`data-disabled`, `data-checked`, etc.) with matching styles.
- Dialog, AlertDialog, Sheet, and Popover focus, Escape, outside-dismissal, collision, and focus-restoration behavior is provided by Base UI. No Radix-specific focus/outside event handlers were present in consumers.
- AlertDialog Action and Cancel both compose Base `Close`; the sessions multi-step action calls `preventDefault()` before advancing its controlled step, while final destructive actions close and restore focus as before.

## Verify by hand

- `pnpm vitest run tests/ui/base-ui-contracts.test.ts` — 18 tests passed. Fixture coverage proves that bundled `radix-ui`, scoped `@radix-ui/react-dialog`, and `require("radix-ui")` are rejected while plain report strings and `data-[state=selected]` are ignored.
- `pnpm typecheck` — passed (`tsc --noEmit`).
- `pnpm lint` — passed with 0 errors and one pre-existing warning at `tests/lib/ranking-route.test.ts:5` (`probe` unused).
- `git diff --check` — passed.
- Direct dependency check confirms no `radix-ui` importer or `radix-ui@` package entry; remaining `@radix-ui/*` lockfile entries are transitive through `cmdk`.
- The dialog/alert-dialog focus and Escape path, Select open/close behavior,
  Tabs switching, mobile Sheet widths, and Sidebar collapse checks are recorded
  in the final browser evidence below.

Remaining Radix wrappers: **0** (16/16 migrated).

## Final verification (2026-09-10)

- Browser validation used the Next dev server on port 3100 and the Next MCP
  preflight. `get_compilation_issues` returned no issues and `get_errors`
  returned empty `configErrors` and `sessionErrors` after the route pass.
- The following authenticated routes loaded successfully at desktop width:
  `/admin`, `/admin/config`, `/admin/sessions`, `/admin/kb`, `/admin/groups`,
  `/admin/handoff`, `/admin/plugins`, `/admin/reflection`, and
  `/admin/ranking`. At 390px and 320px, the checked routes kept document
  `scrollWidth === innerWidth`; the groups table and KB truncation are
  intentional inner overflow regions rather than page overflow.
- Manual interaction checks passed for the login invalid-token error path,
  desktop sidebar collapse/restore, mobile Sheet open/Escape close, Dialog
  Escape plus focus return, Select listbox open/close, Config Tabs switching,
  and the light/dark theme toggle at 320px.
- The final `pnpm check` passed (85 test files, 931 tests); ESLint reported
  zero errors and the existing `tests/lib/ranking-route.test.ts:5` warning.
  `NEXT_DIST_DIR=.next-verify pnpm build` also passed and generated all 40
  static pages. The generated directory was removed from the worktree after
  verification.
- A fresh residual scan found no `radix-ui`, `@radix-ui`, `Slot`, or `asChild`
  source references under `components`, `app`, or `lib`; the only remaining
  `data-[state=...]` classes are the table selected state and Base sidebar
  collapsed state. The lockfile's transitive Radix entries remain through
  `cmdk` by design.
- The dev log still showed the pre-existing Telegram `409 Conflict:
  terminated by other getUpdates request` heartbeat condition; it is unrelated
  to the UI migration and was not treated as a browser regression.
