# Select migration

## Changed

- Replaced Radix Select with `@base-ui/react/select` 1.6.0 while keeping the public `Select*` wrapper names.
- `SelectContent` now renders `Portal > Positioner > Popup > List`; `alignItemWithTrigger` is explicitly derived from the compatibility `position` option.
- Replaced `Viewport` with `List`, `ScrollUpButton`/`ScrollDownButton` with Base `ScrollUpArrow`/`ScrollDownArrow`, and kept `ItemText` before `ItemIndicator`.
- Guarded all Select consumers against Base's `onValueChange` `string | null` callback so null never overwrites existing business defaults.

## Left alone

- Trigger sizing, placeholder rendering, labels, separators, check/chevron icons, data-slot attributes, and existing visual tokens remain unchanged in meaning.
- Existing `position="item-aligned" | "popper"` and `align` wrapper API remains accepted; no current consumer relied on a non-default position.

## Behavior changes

- Base UI supplies keyboard navigation (Arrow/Home/End/typeahead), Escape/outside dismissal, form hidden-input semantics, and popup collision handling.
- Popup sizing uses Base CSS variables (`--available-height`, `--anchor-width`); scroll arrows are hidden when `data-visible=false`.
- Clearing a controlled Select emits `null`; consumer setters now ignore null where the previous business state has no empty-value meaning.

## Verify by hand

- `pnpm vitest run tests/ui/select-migration-contracts.test.ts` — 1 test passed.
- `pnpm typecheck` — passed (`tsc --noEmit`).
- `pnpm lint` — 0 errors; one pre-existing warning in `tests/lib/ranking-route.test.ts:5` (`probe` unused).
- Manual browser checks still required: Arrow/Home/End/typeahead, Escape/outside close, form submission, popup width, scroll arrows, placeholder/null behavior, and 320/390px admin views.

## Residual scan

```text
$ rg -n "position=|SelectPrimitive\.Viewport|radix-ui|@radix-ui" components/ui/select.tsx app/admin/config app/admin/groups/page.tsx app/admin/kb/page.tsx components/admin app/admin/plugins/page.tsx
# no output (exit 1)
```

## Fix round 2

- Item-aligned popups now neutralize generic animation via `data-[align-trigger=true]:animate-none`.
- Base `data-side=none` starting styles force scale/opacity to 100% and disable transitions; ending styles are likewise neutralized.
