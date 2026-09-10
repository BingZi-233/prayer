# scroll-area

- Date: 2026-09-09
- Strategy: Replace Radix ScrollArea aliases with the Base UI 1.6.0 Root/Viewport/Scrollbar/Thumb/Corner parts while keeping the current viewport and scrollbar sizing classes.
- Verdict: migrated

## Changed

- `ScrollAreaPrimitive` now imports from `@base-ui/react/scroll-area`.
- `ScrollAreaScrollbar`/`ScrollAreaThumb` map to Base UI `Scrollbar`/`Thumb`; wrapper prop types use Base UI `.Props` types.
- Radix-only `type` propagation was not introduced; orientation remains explicitly passed to the Base scrollbar.

## Left alone

- Root → Viewport → Scrollbar → Thumb → Corner structure and direct consumer children are preserved.
- The viewport `size-full`, rounded/focus styles, scrollbar dimensions, and message list layout remain unchanged.
- `components/ui/message-scroller.tsx` was read only; no business or scrolling logic changed.

## Behavior changes

- Base UI measures overflow directly from its Viewport and exposes no Radix `type` prop. No consumer currently passes `type`; orientation remains vertical by default.

## Verify by hand

- `pnpm vitest run tests/ui/tabs-scroll-area-migration-contracts.test.ts` — 2 passed.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed with the pre-existing unused `probe` warning in `tests/lib/ranking-route.test.ts`.
