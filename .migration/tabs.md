# tabs

- Date: 2026-09-09
- Strategy: Replace Radix Tabs primitives with the Base UI 1.6.0 Tabs parts while preserving the existing wrapper API, variants, orientation, and consumer markup.
- Verdict: migrated

## Changed

- `TabsPrimitive` now imports from `@base-ui/react/tabs`.
- `Trigger`/`Content` map to Base UI `Tab`/`Panel`; active styling remains on `data-active`.
- Wrapper prop types use Base UI `.Props` types and preserve explicit `orientation`.
- Added Base UI's `aria-disabled` visual parity to tab styling.

## Left alone

- `app/admin/config/page.tsx` consumer markup and five-category settings behavior were unchanged.
- The existing list variants, spacing, focus styles, and panel layout remain intact.
- `components/ui/message-scroller.tsx` was read only; no business or scrolling logic changed.

## Behavior changes

- Base UI Tabs uses manual activation by default. Radix's `activationMode` prop is not forwarded because Base UI 1.6.0 does not expose that prop; keyboard activation behavior may therefore differ for consumers that relied on automatic activation.

## Verify by hand

- `pnpm vitest run tests/ui/tabs-scroll-area-migration-contracts.test.ts` — 2 passed.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed with the pre-existing unused `probe` warning in `tests/lib/ranking-route.test.ts`.
