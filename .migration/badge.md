# Badge Base UI migration

## Changed

- `components/ui/badge.tsx`: replaced Radix `Slot.Root`/`asChild` with Base UI `useRender` and `mergeProps`; retained `badgeVariants`, variant data attributes, and class composition.
- `tests/ui/base-ui-contracts.test.ts`: added the Badge Base UI render/mergeProps contract.

## Left alone

- `app/admin/page.tsx` and `app/admin/sessions/page.tsx`: scanned for Badge `asChild`; no such consumers exist, so no consumer edits were needed.
- Other wrappers and global theme/configuration remain unchanged.

## Behavior

`Badge` renders a `<span>` by default and accepts Base UI's `render` element for polymorphic composition. Existing variant classes, `data-slot`, `data-variant`, children, and event props are preserved through `mergeProps`.

## Consumer scan and verification

```text
$ rg -n "Badge|BubbleContent|asChild" app components --glob '*.{ts,tsx}'
```

The scan found no Badge `asChild` usages. Existing `asChild` matches belong to unmigrated Dialog, Popover, Select, Sheet, Sidebar, and Tooltip wrappers.

```text
$ pnpm vitest run tests/ui/base-ui-contracts.test.ts
2 tests failed (pre-existing full-file contracts for remaining Radix wrappers and radix-mira config); Badge and Bubble contracts passed.

$ pnpm typecheck
$ tsc --noEmit
exit 0
```

## Manual verification

Render Badge with default and each variant, then pass `render={<a href="/">...</a>}` and verify classes, data attributes, content, and link activation remain intact.
