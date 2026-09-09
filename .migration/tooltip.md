# Tooltip migration

## Changed

- Replaced the Radix Tooltip primitive with `@base-ui/react/tooltip` 1.6.0.
- `TooltipContent` now renders `Portal > Positioner > Popup > Arrow` and forwards side/offset positioning to `Positioner`.
- Mapped the public `delayDuration` option to Base Provider's `delay` option.
- Added side-specific arrow classes and Base starting/ending style animation selectors.

## Left alone

- Public `Tooltip`, `TooltipTrigger`, `TooltipContent`, and `TooltipProvider` names remain unchanged.
- Tooltip text, keyboard/focus behavior, and Sidebar's collapsed-state visibility rule remain unchanged.

## Behavior changes

- Base `TooltipProvider` uses `delay`; `disableHoverableContent` was removed because Base 1.6.0 exposes no equivalent provider/content prop (Base root instead has `disableHoverablePopup`).
- Base handles hover/focus delay, Escape/close behavior, and trigger focus restoration.
- Tooltip arrow placement is controlled by Base Positioner/Arrow state and side-specific classes.

## Verify by hand

- `pnpm typecheck` — passed.
- `pnpm lint` — 0 errors; one pre-existing warning in `tests/lib/ranking-route.test.ts:5`.
- Focused contracts: `pnpm vitest run tests/ui/positioning-migration-contracts.test.ts tests/ui/dialog-migration-contracts.test.ts` — 5 tests passed.
- Manually check collapsed Sidebar tooltip delay, keyboard focus, all four sides, viewport edges, and arrow alignment.

## Residual scan

```text
rg -n "TooltipPrimitive\.(Content|Arrow)|delayDuration|disableHoverableContent|asChild|data-open|data-closed" components/ui/tooltip.tsx components/ui/sidebar.tsx app/layout.tsx
# components/ui/tooltip.tsx:9:  delayDuration = 0,
# components/ui/tooltip.tsx:12:  delayDuration?: number
# components/ui/tooltip.tsx:17:      delay={delayDuration}
# components/ui/tooltip.tsx:67:          <TooltipPrimitive.Arrow className="z-50 size-2.5 rotate-45 rounded-[2px] bg-foreground data-[side=bottom]:-translate-y-1/2 data-[side=left]:translate-x-1/2 data-[side=right]:-translate-x-1/2 data-[side=top]:translate-y-1/2" />
# components/ui/sidebar.tsx:400,402-403,420,422-423,497,505,509,548,552,555,656,662,666: unrelated Sidebar Slot asChild APIs
# delayDuration is retained only as the compatibility wrapper prop; Arrow is the expected Base part.
```
