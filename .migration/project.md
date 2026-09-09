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

## Verify by hand

- `pnpm vitest run tests/ui/base-ui-contracts.test.ts` — 15 tests passed. Fixture coverage proves that bundled `radix-ui`, scoped `@radix-ui/react-dialog`, and `require("radix-ui")` are rejected while plain report strings and `data-[state=selected]` are ignored.
- `pnpm typecheck` — passed (`tsc --noEmit`).
- `pnpm lint` — passed with 0 errors and one pre-existing warning at `tests/lib/ranking-route.test.ts:5` (`probe` unused).
- `git diff --check` — passed.
- Direct dependency check confirms no `radix-ui` importer or `radix-ui@` package entry; remaining `@radix-ui/*` lockfile entries are transitive through `cmdk`.
- Manual QA still recommended: dialog/alert-dialog focus return and Escape/outside dismissal, Select keyboard/typeahead/null behavior, Tabs keyboard activation, mobile Sheet widths at 320/390px, Sidebar collapsed tooltips, and Popover collision near viewport edges.

Remaining Radix wrappers: **0** (16/16 migrated).
