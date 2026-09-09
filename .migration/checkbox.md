# Checkbox migration

## Changed

- Switched the root and indicator pair to `Checkbox` parts from `@base-ui/react/checkbox`.
- Kept `data-slot` attributes, dimensions, visual classes, CheckIcon, and form-capable props.

## Left alone

- Admin config state updates and labels remain unchanged.
- No `checked="indeterminate"` consumers exist; no call sites required conversion.

## Behavior changes

- Base UI manages checked and indeterminate state with boolean `checked`/`indeterminate` props and emits `data-checked`, `data-unchecked`, and `data-indeterminate` state attributes.

## Verify by hand

```text
$ pnpm typecheck
$ tsc --noEmit
```

Contract scan confirms Base checkbox root/indicator imports and no Radix import.
