# Base UI migration baseline

Captured 2026-09-09 on branch `feat/ui-base-migration` before any wrapper migration.

## Environment

- `node --version`: exit 0, `v24.16.0`
- `pnpm --version`: exit 0, `11.17.0`
- Next.js: `16.3.4`
- shadcn config style: `radix-mira` (target contract: `base-mira`)
- shadcn base: `radix`
- Tailwind: v4; CSS entry: `app/globals.css`

## 16 wrapper inventory

`components/ui/alert-dialog.tsx`, `badge.tsx`, `bubble.tsx`, `button.tsx`, `checkbox.tsx`, `dialog.tsx`, `label.tsx`, `popover.tsx`, `scroll-area.tsx`, `select.tsx`, `separator.tsx`, `sheet.tsx`, `sidebar.tsx`, `switch.tsx`, `tabs.tsx`, and `tooltip.tsx`.

All 16 currently contain a `radix-ui` import. The contract test intentionally asserts that these imports are absent after migration.

## Consumer inventory

- alert-dialog: `app/admin/kb/page.tsx`, `app/admin/sessions/page.tsx`
- badge: admin capabilities, groups, handoff, kb, overview, plugins, proactive, ranking, reflection, sessions pages; `components/admin/config/qq-settings.tsx`, `tg-settings.tsx`, `components/admin/stat.tsx`
- bubble: `app/admin/sessions/page.tsx`
- button: all admin pages; `app/login/page.tsx`; theme toggle; admin config/data-state; UI alert-dialog, dialog, input-group, message-scroller, sheet, sidebar
- checkbox: admin knowledge, notify, proactive, QQ, and reply settings
- dialog: admin kb, overview, reflection pages; `components/ui/command.tsx`
- label: `components/ui/field.tsx`
- popover: `components/admin/config/qq-settings.tsx`
- scroll-area: `app/admin/kb/page.tsx`
- select: admin groups and plugins pages; `components/admin/config/admin-settings.tsx`
- separator: `app/admin/layout.tsx`, `components/ui/field.tsx`, `components/ui/sidebar.tsx`
- sheet: `app/admin/groups/page.tsx`, `components/ui/sidebar.tsx`
- sidebar: `app/admin/layout.tsx`, `components/app-sidebar.tsx`
- switch: admin groups, plugins, and proactive pages
- tabs: admin capabilities, config, and kb pages; `components/admin/config/config-tab-content.tsx`
- tooltip: `app/layout.tsx`, `components/ui/sidebar.tsx`

## Referenced layout and styling baseline

- `app/admin/layout.tsx` composes `SidebarProvider`, `SidebarInset`, `SidebarTrigger`, and vertical `Separator` around `AppSidebar` and the live admin content.
- `components/app-sidebar.tsx` renders four navigation groups using sidebar primitives, links, active state, and a human-session badge.
- `app/globals.css` imports `shadcn/tailwind.css`, defines Tailwind v4 theme tokens and light/dark CSS variables, and applies base border/outline/body styles.

## Command results

| Command | Exit | Key output |
| --- | ---: | --- |
| `node --version` | 0 | `v24.16.0` |
| `pnpm --version` | 0 | `11.17.0` |
| `pnpm exec shadcn info --json` | 0 | Next.js `16.3.4`; style `radix-mira`; base `radix`; preset code `b1D0dxVg`; 30 components detected |
| `pnpm typecheck` | 0 | `tsc --noEmit` completed |
| `pnpm lint` | 0 | 0 errors, 1 existing warning: `tests/lib/ranking-route.test.ts:5:27` unused `probe` |
| `pnpm test` | 1 | 80 files; 903 tests total, 901 passed, 2 failed in the new contract test (both expected RED failures) |
| `NEXT_DIST_DIR=.next-verify pnpm build` | 0 | Next.js production build compiled, typecheck finished, 40 static pages generated |

No OneBot heartbeat failure or listen-permission failure occurred in these baseline commands. The existing lint warning is retained as baseline context; no production code was changed to alter environment behavior.
