# Task 3 report

Implemented the Button wrapper migration to Base UI 1.6.0 and migrated all Button link/action consumers in scope.

## File-level changes

- `components/ui/button.tsx`: imports `ButtonPrimitive` from `@base-ui/react/button`; removes Radix Slot/asChild; keeps all `buttonVariants` classes, variant/size data attributes, and forwards Base UI props including `render`.
- `components/ui/alert-dialog.tsx`: AlertDialogAction and AlertDialogCancel compose their Radix primitives through `render={<... />}` on Button.
- `app/admin/page.tsx`: handoff link changed from Button `asChild` to Button `render`.
- `app/admin/handoff/page.tsx`: session link changed from Button `asChild` to Button `render`.
- `app/admin/reflection/page.tsx`, `components/app-sidebar.tsx`: inspected; no Button `asChild` consumer to migrate (existing Dialog/sidebar `asChild` remains for their own primitive migrations).
- `tests/ui/base-ui-contracts.test.ts`: added primitive import, ButtonPrimitive, and no-Radix/Slot assertions.
- `.migration/button.md`: migration notes, scan results, behavior notes, and manual verification steps.

## Validation

- Contract test was confirmed RED before implementation.
- `pnpm typecheck` passed.
- Focused Button contract passed: `pnpm vitest run tests/ui/base-ui-contracts.test.ts -t 'Button wrapper'`.
- Full contract file is expected RED until other migration tasks update remaining wrappers and `components.json`.

## Commit

`057f9cb` (`refactor(ui): 迁移 Button 到 Base UI`)

## Fix round 1

Added `nativeButton={false}` to both Link-rendered Button consumers (`app/admin/page.tsx` and `app/admin/handoff/page.tsx`). Base UI 1.6.0 requires this flag when `render` replaces the native button with an anchor, avoiding `useButton` development warnings and preserving link keyboard semantics.

## Fix round 2 evidence

Commands were rerun after the round-1 fix; all exited 0.

```text
$ pnpm typecheck
$ tsc --noEmit
exit 0

$ pnpm vitest run tests/ui/base-ui-contracts.test.ts -t 'Button wrapper'
Test Files  1 passed (1)
Tests  1 passed | 2 skipped (3)
exit 0

$ git diff --check
(no output)
exit 0
```

Commits: `057f9cb` (`refactor(ui): 迁移 Button 到 Base UI`) and `ec73d86` (`fix(ui): set non-native Button links`).
