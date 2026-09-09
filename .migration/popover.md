# Popover migration

## Changed

- Replaced the Radix Popover primitive with `@base-ui/react/popover` 1.6.0.
- `PopoverContent` now renders `Portal > Positioner > Popup`.
- Explicitly destructures and forwards `side`, `sideOffset`, `align`, and `alignOffset` to `Positioner`; visual classes and children are kept on `Popup`.
- `PopoverAnchor` is an inert `<span>` passthrough because Base Popover 1.6.0 has no Anchor part.
- Updated QQ settings and Sidebar trigger consumers from `asChild` to Base `render` composition.

## Left alone

- Public wrapper names and `PopoverContent` defaults (`align="center"`, `sideOffset=4`) remain unchanged.
- Header, title, description, command content, and existing visual tokens remain unchanged in meaning.

## Behavior changes

- Positioning and collision handling are provided by Base Positioner; animation selectors use Base starting/ending style attributes.
- `PopoverAnchor` no longer participates in positioning; callers should use a trigger or an explicit Base anchor strategy when one is introduced.
- Base render composition replaces Radix `asChild` for QQ settings and Sidebar internals.

## Verify by hand

- `pnpm typecheck` — passed.
- `pnpm lint` — 0 errors; one pre-existing warning in `tests/lib/ranking-route.test.ts:5`.
- Focused contracts: `pnpm vitest run tests/ui/positioning-migration-contracts.test.ts tests/ui/dialog-migration-contracts.test.ts` — 5 tests passed.
- Manually check QQ group/admin popovers for start alignment, edge collision/flip, Escape/outside close, and trigger focus return.

## Residual scan

```text
rg -n "PopoverPrimitive\.(Content|Anchor)|<PopoverTrigger[^>]*asChild|data-open|data-closed" components/ui/popover.tsx components/admin/config/qq-settings.tsx
# no matches
```
