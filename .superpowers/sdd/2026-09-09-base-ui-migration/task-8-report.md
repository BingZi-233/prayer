# Task 8 report: Select migration

## Contract-first evidence

Added `tests/ui/select-migration-contracts.test.ts` before implementation. The initial run was RED: the source still imported `radix-ui` and had no Base Select parts. After migration:

```text
$ pnpm vitest run tests/ui/select-migration-contracts.test.ts
Test Files  1 passed (1)
Tests       1 passed (1)
```

## Implementation

- `components/ui/select.tsx` uses `@base-ui/react/select` 1.6.0 and the `Root`, `Portal`, `Positioner`, `Popup`, `List`, `ItemText`, `ItemIndicator`, `ScrollUpArrow`, and `ScrollDownArrow` parts.
- `SelectContent` preserves the wrapper's `position`/`align` API and explicitly maps `position="item-aligned"` to `alignItemWithTrigger={true}` (and `popper` to `false`).
- `app/admin/groups/page.tsx`, `components/admin/config/admin-settings.tsx`, and `app/admin/plugins/page.tsx` guard controlled Select callbacks against `null` without changing defaults.

## Verification commands

```text
$ pnpm typecheck
$ tsc --noEmit
# exit 0

$ pnpm lint
# 0 errors; 1 pre-existing warning (tests/lib/ranking-route.test.ts:5, probe unused)

$ pnpm vitest run tests/ui/select-migration-contracts.test.ts tests/ui/positioning-migration-contracts.test.ts
# 3 tests passed
```

## Residual scan

```text
$ rg -n "position=|SelectPrimitive\.Viewport|radix-ui|@radix-ui" components/ui/select.tsx app/admin/config app/admin/groups/page.tsx app/admin/kb/page.tsx components/admin app/admin/plugins/page.tsx
# no output (exit 1)
```

## Concerns

- Existing repository-wide Base migration contracts remain red for unrelated pre-existing `Tabs`/`Sidebar` Radix imports and `components.json`'s `radix-mira` style; those files are outside Task 8 scope.
- Manual browser interaction checks remain to be performed in a running admin UI.
