# sidebar

- Date: 2026-09-09
- Strategy: replay check-cx-admin base-mira Sidebar structure while preserving prayer navigation, live brand, human-session badge, cookie state, and mobile behavior
- Verdict: migrated

## Changed

- Replaced Radix `Slot`/`asChild` polymorphism with Base UI `useRender` and `mergeProps` for group labels/actions, menu buttons/actions, and submenu buttons.
- Preserved SidebarProvider state, cookie persistence, keyboard shortcut, desktop variants, mobile Sheet, and existing layout classes.
- Updated `AppSidebar` navigation links to `render={<Link ... />}` while retaining active route logic, four Chinese groups, dynamic brand, and human queue badge.

## Left alone

- API, authentication, LiveProvider, route structure, navigation data, and business logic.
- Existing Button, Sheet, Tooltip, Separator, Input, and Skeleton wrappers.

## Behavior changes

- Base UI render composition now owns polymorphic element/ref/event merging. Tooltip-wrapped menu buttons continue to appear only when the sidebar is collapsed on desktop.
- No intended user-facing behavior change; Base UI may expose `data-slot`, `data-sidebar`, `data-size`, and `data-active` state attributes through `useRender`.

## Verify by hand

- `pnpm exec vitest run tests/ui/sidebar-migration-contracts.test.ts` — 2 passed.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed with one pre-existing unused-variable warning in `tests/lib/ranking-route.test.ts`.
- Manual desktop/mobile keyboard and tooltip checks remain part of final browser verification.
