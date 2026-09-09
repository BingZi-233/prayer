# AlertDialog migration

## Changed

- Replaced the Radix AlertDialog import with `@base-ui/react/alert-dialog` 1.6.0.
- Kept the public `AlertDialog*` wrapper names and boolean controlled state API.
- Mapped `Overlay` to `Backdrop`, `Content` to `Popup`, and `Cancel` to Base `Close`.
- `AlertDialogAction` is now an ordinary Base Button, retaining `variant`/`size` and destructive styling supplied by consumers.
- Alert dialog transitions now target `data-starting-style` and `data-ending-style`.

## Left alone

- Header, footer, media, title, description, sizing classes, and confirmation copy remain unchanged.
- Delete and discard consumers in `app/admin/kb/page.tsx` already close through their controlled `onOpenChange`/action handlers; no `asChild` or Radix focus/outside event props are present.
- `app/admin/groups/page.tsx` has no AlertDialog usage.

## Behavior changes

- Base AlertDialog provides modal focus trapping, Escape/outside-press behavior, and focus restoration. Radix-specific event parameters were not passed through.
- Cancel uses Base `Close`; Action intentionally remains a regular Button so existing async delete/discard handlers control completion.

## Verify by hand

- Automated focused contract: `pnpm vitest run tests/ui/dialog-migration-contracts.test.ts` — 2 tests passed.
- `pnpm typecheck` was run; it remains blocked by the pre-existing `components/ui/command.tsx:59` `PayloadChildRenderFunction` type error (no AlertDialog errors).
- `pnpm lint` is required at integration time; run it with the rest of the migration suite.
- Manual browser checks still required: destructive confirmation, Cancel/Action close behavior, Escape/outside click, focus return, and 320/390px width.
