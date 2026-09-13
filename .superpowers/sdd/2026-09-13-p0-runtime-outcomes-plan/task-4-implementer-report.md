# Task 4 implementer report

Date: 2026-09-13

## Scope completed

- `appConfigSchema.parse` now clamps `proactiveCandidateBudget` to at least `proactiveMaxPerScan`; `.shape`-based patch and stored-config normalization use the base object schema.
- `Agent.run` marks SDK result error subtypes and `is_error: true` results as `failed` without text or `partial` with accumulated text.
- Unknown/unregistered channel failures use the same bounded exponential retry schedule as registered send failures (1s, 2s, 4s, capped at 60s) in both dispatch and retry paths.
- Added explicit duplicate `delivery.recorded` idempotency coverage and a real proactive pending-to-sent flow through reply mapper, ChannelRegistry, and SQLite outbox.
- Added v9 legacy-row/default migration coverage.
- Proactive delivery keys use the stable `group_messages.id` when a platform message ID is absent, avoiding text-based collisions.
- No prompt/model behavior or ACK/blocked/handoff decisions were changed.

## Verification evidence

### Red

Command:

```text
pnpm vitest run tests/lib/core/config/schema.test.ts tests/lib/conversation/agent.test.ts tests/lib/channels/registry.test.ts tests/lib/conversation/delivery-recorder.test.ts
```

Observed: 4 expected failures (schema clamp, two Agent terminal-error cases, unknown-channel retry backoff).

Command:

```text
pnpm vitest run tests/lib/conversation/pollers/unanswered.test.ts -t 'messageId 缺失时 deliveryKey'
```

Observed: expected collision-safe key failure; received the old text-derived key.

### Green

Command:

```text
pnpm vitest run tests/lib/core/config/schema.test.ts tests/lib/core/config/patch.test.ts tests/lib/conversation/agent.test.ts tests/lib/channels/registry.test.ts tests/lib/channels/qq/channel.test.ts tests/lib/channels/tg/client.test.ts tests/lib/conversation/delivery-recorder.test.ts tests/lib/conversation/pollers/unanswered.test.ts tests/lib/core/db/migrations.test.ts tests/lib/core/db/outbox.test.ts tests/lib/core/db/repo.test.ts tests/lib/core/db/repo.stats.test.ts
```

Observed: 12 files passed, 198 tests passed.

Command:

```text
pnpm check
```

Observed: typecheck passed; ESLint exited 0 with one pre-existing warning in `tests/lib/ranking-route.test.ts`; Vitest passed 103 files / 1,015 tests.

Command:

```text
pnpm typecheck && pnpm lint
```

Observed: exit 0; same single pre-existing ranking-route warning.

## Commits

- `48792c9` — `fix: harden runtime outcome verification gaps`
- Report-only commit containing this report (see `git log` for its hash).

## Files changed by the runtime fix commit

- `lib/channels/registry.ts`
- `lib/conversation/agent.ts`
- `lib/conversation/pollers/unanswered.ts`
- `lib/core/config/patch.ts`
- `lib/core/config/schema.ts`
- `lib/core/db/models.ts`
- `lib/core/db/repositories/messages.ts`
- `lib/core/db/rows.ts`
- Focused regression tests under `tests/lib/channels`, `tests/lib/conversation`, and `tests/lib/core`.

## Risks / concerns

- The existing lint warning in `tests/lib/ranking-route.test.ts` remains unrelated and unchanged.
- Durable outbox semantics remain local at-least-once; a process crash after platform acceptance can still produce a duplicate, as specified.
- Existing unrelated KB/reflection/package edits were preserved and not staged.

## Task 4 reviewer follow-up (round 1)

- Fixed the registered-channel `dispatch` rejection path to use the shared attempts-based retry delay helper.
- Added a regression using a claimed record with `attempts=3`; it asserts `now + 4000` after an actual registered channel send rejection.

Verification:

```text
pnpm vitest run tests/lib/channels/registry.test.ts
```

Observed: 1 file passed, 15 tests passed.

```text
pnpm typecheck && pnpm lint
```

Observed: exit 0; one pre-existing warning remains in `tests/lib/ranking-route.test.ts`.

Red command before the fix:

```text
pnpm vitest run tests/lib/channels/registry.test.ts -t 'registered channel send rejection'
```

Observed: failed with `expected 14000, received 11000`.

## Task 4 final review fix wave

- `recordDelivery` now compares sent chunk count with `repo.deliveryExpected` and records `pending` until every planned chunk is sent.
- `registerResolutionRecorder` now falls back to `resolutionKey` when `deliveryKey` is absent, preserving an updatable delivery row.

Red command:

```text
pnpm vitest run tests/lib/conversation/delivery-recorder.test.ts -t 'recordDelivery waits|resolutionKey is persisted'
```

Observed: 2 expected failures: one-of-two was counted as sent, and a resolution-only event persisted a NULL delivery key.

Green commands:

```text
pnpm vitest run tests/lib/conversation/delivery-recorder.test.ts -t 'recordDelivery waits|resolutionKey is persisted'
```

Observed: 1 file passed, 2 tests passed.

```text
pnpm vitest run tests/lib/conversation/delivery-recorder.test.ts tests/lib/conversation/pollers/unanswered.test.ts tests/lib/core/db/repo.stats.test.ts
```

Observed: 3 files passed, 42 tests passed.

```text
pnpm typecheck && pnpm lint
```

Observed: exit 0; one pre-existing warning remains in `tests/lib/ranking-route.test.ts`.
