# Label migration

## Changed

- Replaced the Radix Label root with a native `<label>` element typed as `React.ComponentProps<"label">`.
- Kept `data-slot="label"`, `htmlFor`, class merging, `select-none`, and peer/group disabled styling.

## Left alone

- No Field behavior, business labels, copy, or form wiring changed.

## Behavior changes

- The wrapper now has native label semantics and no Radix runtime dependency. Disabled presentation remains CSS-driven through the existing peer/group selectors.

## Verify by hand

```text
$ pnpm typecheck
$ tsc --noEmit
```

Contract scan confirms no `radix-ui`/`LabelPrimitive` import and `React.ComponentProps<"label">` typing.
