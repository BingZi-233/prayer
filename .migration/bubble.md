# Bubble Base UI migration

## Changed

- `components/ui/bubble.tsx`: replaced `BubbleContent`'s Radix `Slot.Root`/`asChild` path with Base UI `useRender` and `mergeProps`; retained BubbleGroup, Bubble, BubbleReactions, all visual classes, alignment, and message layout.
- `tests/ui/base-ui-contracts.test.ts`: added the BubbleContent Base UI render/mergeProps contract.

## Left alone

- `app/admin/sessions/page.tsx`: BubbleContent has no `asChild` consumer; existing default `<BubbleContent>` remains unchanged.
- `app/admin/page.tsx`: no BubbleContent usage; existing Dialog `asChild` belongs to a different wrapper and is intentionally untouched.

## Behavior

`BubbleContent` renders a `<div>` by default and accepts Base UI's `render` element for polymorphic composition. `data-slot="bubble-content"`, class merging, align-dependent styles, and all Bubble message layout variants remain unchanged.

## Consumer scan and verification

```text
$ rg -n "Badge|BubbleContent|asChild" app components --glob '*.{ts,tsx}'
```

No BubbleContent `asChild` consumers were found; unrelated `asChild` usages remain in wrappers outside this task's scope.

```text
$ pnpm vitest run tests/ui/base-ui-contracts.test.ts
2 tests failed (pre-existing full-file contracts for remaining Radix wrappers and radix-mira config); Badge and Bubble contracts passed.

$ pnpm typecheck
$ tsc --noEmit
exit 0
```

## Manual verification

Render start/end bubbles with each variant and a whitespace-preserving message. Pass `render` to BubbleContent with an anchor or button and verify layout, alignment, hover/focus styles, and event behavior.
