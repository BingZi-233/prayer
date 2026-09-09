# visual-theme

2026-09-10, rebuilt the global visual baseline from check-cx-admin's base-mira
theme while retaining Prayer's runtime/auth boundaries — verdict: focused
contracts, typecheck, lint, and diff checks pass.

## Changed

- `app/globals.css`: added Inter/system-CJK sans and Geist Mono tokens, amber
  light/dark/sidebar/chart tokens, base-mira radius formulas, and reduced-motion
  safeguards. The existing destructive token values remain Prayer-compatible.
- `app/layout.tsx`: registered `Inter` and `Geist_Mono`, removed the html-level
  `font-mono` class, and kept Prayer metadata, `ThemeProvider`,
  `TooltipProvider`, and `Toaster`.
- `components/ui/card.tsx`: kept the size-aware spacing/ring contract and
  aligned CardTitle with the sans base-mira title treatment.
- `components/admin/page-header.tsx` and `section-card.tsx`: allow action
  controls to wrap at narrow widths without changing their props or data.
- `app/login/page.tsx`: aligned the background, brand mark, and card width;
  the ADMIN_TOKEN request, router guard, Suspense boundary, and error handling
  are unchanged.

## Left alone

- `font-mono` remains on token, endpoint, id, JSON, code, and Markdown code
  fields. No business data, API route, auth cookie, or copy was changed.
- Existing Prayer status/destructive colors and responsive admin shell spacing
  remain intact; CardAction still stacks on narrow screens.
- `components/admin/stat.tsx` retains its MetricBadge API and data semantics;
  the new primary token supplies the shared visual accent.

## Behavior changes

- Body text now uses the browser sans baseline with Inter and system Chinese
  fallbacks; explicit `font-mono` fields remain monospaced.
- Primary/default controls use the amber base-mira token in light and dark
  themes. This is intentional visual behavior, not a business-state change.
- Header and SectionCard actions can wrap at narrow widths, preventing long
  action labels from forcing horizontal overflow.
- Reduced-motion media rules shorten transitions/animations and disable smooth
  scrolling when the user requests reduced motion.

## Verify by hand

- `pnpm vitest run tests/ui/base-ui-contracts.test.ts` — 17 tests passed.
- `pnpm typecheck` — passed (`tsc --noEmit`).
- `pnpm lint` — passed with 0 errors and one pre-existing warning at
  `tests/lib/ranking-route.test.ts:5` (`probe` unused).
- `git diff --check` — passed.
- Check `/login` at 320px and 390px: card remains within the viewport, the
  token form still submits to `/api/auth/login`, and invalid tokens retain the
  existing toast/error path. Check both `.light` and `.dark` themes for amber
  primary contrast and readable muted text.
