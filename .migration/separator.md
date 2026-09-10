# Separator migration

## Changed

- Replaced Radix with callable `Separator` from `@base-ui/react/separator`.
- Retained `data-slot="separator"`, orientation defaulting, and horizontal/vertical sizing classes.

## Left alone

- Existing consumers and the vertical orientation API remain unchanged.
- No decorative prop is forwarded because Base UI's callable primitive does not expose it.

## Behavior changes

- Rendering uses Base UI's separator state/data attributes (`data-horizontal`/`data-vertical`) and native div output.

## Verify by hand

```text
$ pnpm typecheck
$ tsc --noEmit
```

Contract scan confirms `@base-ui/react/separator`, a direct `<SeparatorPrimitive />`, and no `decorative` or Radix references.
