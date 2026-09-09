# admin-shell

2026-09-10, aligned the Prayer admin shell and shared workbench density with the
base-mira visual direction while retaining all live state and route behavior —
focused contract, typecheck, lint, and diff checks pass.

## Changed

- `app/admin/layout.tsx`: kept `LiveProvider`, `SidebarProvider`, `AppSidebar`,
  `SidebarInset`, `BrandTitle`, `HeaderStatus`, `SidebarTrigger`, and the
  vertical `Separator`; added the inset muted surface, desktop rounded/shadowed
  boundary, compact sticky `h-14` header, and `p-3 sm:p-4 md:p-6` content
  spacing.
- `components/app-sidebar.tsx`: tightened the brand block and group label
  density with sidebar-border/foreground tokens while preserving all four
  Chinese navigation groups, dynamic brand fallback, active matching, and the
  `humanSessions` badge.
- `components/admin/page-shell.tsx`, `master-detail.tsx`, `data-state.tsx`,
  `item-card.tsx`, and `virtual-list.tsx`: added min-width/min-height guards,
  responsive gaps, compact empty/error vertical rhythm, card ring/border
  treatment, and overscroll containment. The mobile master-detail hidden
  switching and virtualizer measurement/scroll container remain unchanged.
- Visual-only route updates in `app/admin/page.tsx`, `sessions/page.tsx`,
  `config/page.tsx`, and `reflection/page.tsx` add narrow-layout guards and
  base-mira card/tab density without changing handlers, API calls, state, or
  copy.
- `tests/ui/base-ui-contracts.test.ts`: added the admin-shell contract for the
  inset surface, rounded boundary, sticky 14px header, and `md:p-6` spacing.

## Left alone

- All API routes, fetch/mutation handlers, LiveProvider state, navigation hrefs,
  auth boundaries, data schemas, and business labels remain untouched.
- `components/admin/page-header.tsx`, `section-card.tsx`, and non-admin
  primitives were left alone; their existing responsive wrapping and Base UI
  contracts are consumed by this shell.
- `font-mono` occurrences remain only in identifiers, tokens, endpoints, and
  code/Markdown content. No stale Radix data-state selector or runtime import
  was introduced.

## Behavior changes

- The desktop content surface now has the inset muted background with a rounded
  boundary and subtle shadow; the mobile surface remains edge-to-edge.
- Empty/error states have a minimum compact vertical rhythm, cards have a
  light ring/border treatment, and navigation labels use the sidebar muted
  foreground token. These are visual-only changes.
- No intended changes to route transitions, sidebar persistence, mobile
  master-detail switching, virtual-list measurement, or scrolling behavior.

## Verify by hand

- `pnpm vitest run tests/ui/base-ui-contracts.test.ts` — 18 tests passed.
- `pnpm typecheck` — passed (`tsc --noEmit`).
- `pnpm lint` — passed with 0 errors and the existing warning at
  `tests/lib/ranking-route.test.ts:5` (`probe` unused).
- `git diff --check` — passed; the requested visual residual scan ran with
  `rg -n "rounded-|border|p-|gap-|font-mono|data-\\[state" app/admin
  components/admin --glob '*.{ts,tsx}'` (161 expected class/data matches).
- Manual follow-up for the final browser pass: inspect `/admin`, `/admin/sessions`,
  `/admin/handoff`, `/admin/kb`, `/admin/config`, `/admin/groups`,
  `/admin/plugins`, `/admin/reflection`, and `/admin/ranking` in light/dark at
  390px and 320px; confirm no horizontal overflow, intact sticky header, and
  preserved list/detail scrolling.
