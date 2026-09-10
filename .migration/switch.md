# Switch migration

## Changed

- Switched the root and thumb pair to `Switch` parts from `@base-ui/react/switch`.
- Kept `data-slot`, `data-size`, size classes, state classes, and form semantics.

## Left alone

- No admin config business logic or copy changed; there are no Switch consumers requiring prop edits.

## Behavior changes

- Base UI uses boolean `checked`/`defaultChecked` and `onCheckedChange`, with `data-checked`/`data-unchecked`/`data-disabled` state attributes.

## Verify by hand

```text
$ pnpm typecheck
$ tsc --noEmit
```

Contract scan confirms Base switch root/thumb imports and no Radix import. Keyboard activation remains Base UI's Space/Enter behavior.
