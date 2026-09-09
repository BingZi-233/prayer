# AlertDialog migration

## Changed

- Replaced the Radix AlertDialog import with `@base-ui/react/alert-dialog` 1.6.0.
- Kept the public `AlertDialog*` wrapper names and boolean controlled state API.
- Mapped `Overlay` to `Backdrop`, `Content` to `Popup`, and `Cancel` to Base `Close`.
- `AlertDialogAction` and `AlertDialogCancel` both compose Base `Close` through the shared Button `render` API, retaining `variant`/`size` and destructive styling supplied by consumers.
- Alert dialog transitions now target `data-starting-style` and `data-ending-style`.

## Left alone

- Header, footer, media, title, description, sizing classes, and confirmation copy remain unchanged.
- Delete and discard consumers in `app/admin/kb/page.tsx` already close through their controlled `onOpenChange`/action handlers; no `asChild` or Radix focus/outside event props are present.
- `app/admin/groups/page.tsx` has no AlertDialog usage.

## Behavior changes

- Base AlertDialog provides modal focus trapping, Escape/outside-press behavior, and focus restoration. Radix-specific event parameters were not passed through.
- Cancel and Action use Base `Close`, so successful action presses close the alert dialog and restore focus. The existing multi-step session action calls both `preventDefault()` and Base UI's `preventBaseUIHandler()` before advancing its controlled step, so that intermediate confirmation remains open; async handlers retain their existing side effects.

## Verify by hand

- Automated focused contract: `pnpm vitest run tests/ui/dialog-migration-contracts.test.ts` — 4 tests passed.
- `pnpm typecheck` passes. AlertDialog has no surfaced children-propagation error in current consumers; its root remains otherwise unchanged.
- `pnpm lint` completed with 0 errors and 1 pre-existing warning in `tests/lib/ranking-route.test.ts:5` (`probe` unused).
- Final browser evidence for destructive confirmation, Cancel/Action close behavior, the sessions intermediate step staying open, Escape/outside click, focus return, and 320/390px width is recorded in `.migration/project.md`; the destructive final action was not executed against live session data.

## Residual scan

```text
rg -n "AlertDialogPrimitive\\.(Overlay|Content|Cancel|Action)|asChild|onOpenAutoFocus|onCloseAutoFocus|onInteractOutside" components/ui/alert-dialog.tsx app/admin/kb/page.tsx app/admin/page.tsx app/admin/reflection/page.tsx app/admin/groups/page.tsx
# no matches
```
