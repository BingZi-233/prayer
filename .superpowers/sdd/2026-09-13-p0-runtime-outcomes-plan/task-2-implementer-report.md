# Task 2 implementer report

## Red evidence

After adding the tri-state, retry, candidate-budget, partial-agent, and schema tests, the focused command failed as expected:

```text
pnpm vitest run tests/lib/conversation/answerability.test.ts tests/lib/conversation/pollers/unanswered.test.ts tests/lib/core/config/schema.test.ts
```

Result: 3 files failed, 12 tests failed, 19 passed. The failures showed the boolean classifier, missing candidate budget, and missing schema default.

## Green evidence

```text
pnpm vitest run tests/lib/conversation/answerability.test.ts tests/lib/conversation/pollers/unanswered.test.ts tests/lib/core/config/schema.test.ts
```

Result: 3 files passed, 31 tests passed.

Additional compatibility coverage:

```text
pnpm vitest run tests/lib/conversation/answerability.test.ts tests/lib/conversation/pollers/unanswered.test.ts tests/lib/core/config/schema.test.ts tests/lib/core/config-store.test.ts tests/lib/runtime.test.ts tests/lib/conversation/bypass-gating.test.ts tests/lib/core/config/patch.test.ts
```

Result: 7 files passed, 102 tests passed.

```text
pnpm exec tsc --noEmit
pnpm exec eslint lib/conversation/answerability.ts lib/conversation/pollers/unanswered.ts lib/conversation/assemble.ts lib/runtime.ts lib/core/config/schema.ts tests/lib/conversation/answerability.test.ts tests/lib/conversation/pollers/unanswered.test.ts tests/lib/core/config/schema.test.ts
```

Both completed successfully.

## Changes

- Added typed `AnswerabilityDecision`/`AnswerabilityResult` with sanitized error reasons (`timeout`, `invalid_output`, `classifier_error`).
- Updated classifier parsing and timeout/error outcomes; empty input remains `not_answerable`.
- Added retry-safe classifier and Agent status branches in the proactive poller. Partial/failed Agent results and classifier errors retain the cursor and emit a sanitized `proactive_silent` detail.
- Added a finite per-chat candidate budget, clamped to at least one and at least `maxPerScan`; candidate counting occurs before classification/Agent work.
- Added `proactiveCandidateBudget` (schema default `12`) and threaded it through `AppConfig`, runtime, and assembly.
- Kept poller boundary compatibility for older boolean classifier test doubles and Agent results without a status field.

## Files

`lib/conversation/answerability.ts`, `lib/conversation/pollers/unanswered.ts`, `lib/conversation/assemble.ts`, `lib/runtime.ts`, `lib/core/config/schema.ts`, `tests/lib/conversation/answerability.test.ts`, `tests/lib/conversation/pollers/unanswered.test.ts`, and `tests/lib/core/config/schema.test.ts`.

## Risks

- Existing hand-written `AppConfig` objects may omit `proactiveCandidateBudget`; the public type keeps that field optional and runtime resolution supplies the default.
- Legacy boolean classifier doubles are accepted only at the poller dependency boundary; production classifiers return the tri-state result.
- The schema field itself defaults to `12`; the cross-field lower bound against `proactiveMaxPerScan` is enforced when the poller resolves runtime dependencies.

## Commit

`3dee231` (`fix: bound proactive candidates and preserve retryable errors`)
