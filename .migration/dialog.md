# Dialog migration

## Changed

- Replaced the Radix Dialog import with `@base-ui/react/dialog` 1.6.0.
- Kept the public `Dialog*` wrapper names and boolean `open`/`onOpenChange` API.
- Mapped `Overlay` to `Backdrop` and `Content` to `Popup`; centered content remains un-positioned and uses the existing fixed centering classes.
- Close controls now use Base `Dialog.Close` with `render={<Button ... />}`. The `showCloseButton` and footer close options remain available.
- Updated the admin status and reflection consumers from Radix `asChild` to Base `render` composition.
- Dialog open/close transitions now target `data-starting-style` and `data-ending-style`.

## Left alone

- Header, footer, title, description, class names, close icon, and slot attributes remain unchanged in meaning.
- No Dialog consumers use `onOpenAutoFocus`, `onCloseAutoFocus`, or `onInteractOutside`.
- `app/admin/kb/page.tsx` and `app/admin/groups/page.tsx` required no consumer changes; their dialogs only use the boolean controlled API and native Button handlers.

## Behavior changes

- Base UI supplies focus trapping, Escape handling, outside-press dismissal, and trigger focus restoration. No Radix event handlers were forwarded to Base props.
- Base's `render` composition replaces `asChild`; the rendered Button remains the actual trigger/close element.
- Transition selectors use Base's starting/ending style attributes instead of Radix open/closed animation selectors.

## Verify by hand

- Automated focused contract: `pnpm vitest run tests/ui/dialog-migration-contracts.test.ts` — 2 tests passed.
- `pnpm typecheck` was run; it remains blocked by the pre-existing `components/ui/command.tsx:59` `PayloadChildRenderFunction` type error (no Dialog errors).
- `pnpm lint` completed with 0 errors and 1 pre-existing warning in `tests/lib/ranking-route.test.ts:5` (`probe` unused).
- Manual browser checks still required: open from admin status/reflection, close with Escape, outside click, focus return to trigger, and 320/390px width.

## Residual scan

```text
rg -n "DialogPrimitive\\.(Overlay|Content)|asChild|onOpenAutoFocus|onCloseAutoFocus|onInteractOutside" components/ui/dialog.tsx app/admin/page.tsx app/admin/reflection/page.tsx app/admin/kb/page.tsx app/admin/groups/page.tsx
# no matches
```
