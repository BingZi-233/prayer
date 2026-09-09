# Sheet migration

## Changed

- Replaced the Radix Dialog primitive with `@base-ui/react/dialog` 1.6.0.
- Mapped the public Sheet overlay/content wrappers to Base `Backdrop` and `Popup` while retaining `Sheet*` names and portal structure.
- Preserved side-specific layout, mobile width, close button, Header, Footer, title, and description styles.
- Switched open/close animation selectors to Base `data-starting-style` and `data-ending-style` attributes.

## Left alone

- `side`, `showCloseButton`, `data-slot` values, and the existing consumer-facing Sheet API remain unchanged.
- Sidebar mobile and admin group consumers continue to use the same Sheet wrappers.

## Behavior changes

- Base UI supplies focus management, Escape dismissal, outside-press dismissal, and trigger focus restoration.
- Close composition uses Base `render` rather than Radix `asChild`.

## Verify by hand

- `pnpm typecheck` — passed.
- `pnpm lint` — 0 errors; one pre-existing warning in `tests/lib/ranking-route.test.ts:5`.
- Focused contracts: `pnpm vitest run tests/ui/positioning-migration-contracts.test.ts tests/ui/dialog-migration-contracts.test.ts` — 5 tests passed.
- Manually check mobile side placement at 320/390px, Escape/outside close, focus return, and each side's enter/exit animation.

## Residual scan

```text
rg -n "SheetPrimitive\.(Overlay|Content)|asChild|data-open|data-closed" components/ui/sheet.tsx
# no matches
```
