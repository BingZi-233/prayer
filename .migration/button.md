# Button Base UI migration

## Changed files

- `components/ui/button.tsx`: replaced the Radix `Slot.Root` wrapper with `@base-ui/react/button`'s `ButtonPrimitive`; `variant`, `size`, `data-*` attributes, and the complete `buttonVariants` class string are preserved.
- `components/ui/alert-dialog.tsx`: Alert/Cancel actions now compose through Button's `render` prop.
- `app/admin/page.tsx`: the handoff link Button uses `render={<Link ... />}`.
- `app/admin/handoff/page.tsx`: the session link Button uses `render={<Link ... />}`.
- `tests/ui/base-ui-contracts.test.ts`: added the Button primitive/no-Radix contract.

`app/admin/reflection/page.tsx` and `components/app-sidebar.tsx` contain no Button `asChild` usage; their existing Radix dialog/sidebar composition is intentionally unchanged until those primitives are migrated.

## Class and behavior notes

All existing `buttonVariants` variant/size classes and icon selectors are unchanged. Base UI's `render` composes props onto the supplied Link or AlertDialog action element, preserving Prayer routes, labels, click handlers, and disabled state. The wrapper no longer accepts `asChild`; callers should pass a React element with `render`.

## Scans and verification

- `rg -n "<Button[^>]*asChild|Slot\\.Root" components/ui/button.tsx app/admin/page.tsx app/admin/reflection/page.tsx app/admin/handoff/page.tsx components/app-sidebar.tsx`: no Button/Slot matches remain in the migrated Button paths.
- `pnpm typecheck`: passed.
- `pnpm vitest run tests/ui/base-ui-contracts.test.ts -t 'Button wrapper'`: passed.
- Full contract test remains red on pre-existing Task 1/2 contracts (other wrappers still import Radix and `components.json` is still `radix-mira`).

## Manual checks

1. Open `/admin` and click the “人工会话” link and restart dialog trigger.
2. Open `/admin/handoff` and click “查看会话”.
3. Verify native Button keyboard activation, disabled styling, and icon sizing in each dialog/action state.
