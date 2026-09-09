# Task 3 report

## Red to green

- Added concurrency and ranking route contract tests first; initial run failed because `lib/concurrency` was missing and the hoisted route mocks were invalid.
- Implemented `mapWithConcurrency` with stable ordering, worker index propagation, error rejection, and `RangeError` for non-positive limits.
- Ranking now performs one `topicSamplesBatch` call, evaluates only the first 30 topics with a maximum of four concurrent embeddings, and falls back to topic title when samples are empty.

## Verification

- Target tests: concurrency, ranking route, and topic DB tests — 4 passed.
- `pnpm vitest run tests/lib` — 74 files, 782 tests passed.
- `pnpm typecheck` passed; `git diff --check` passed.
- Query call count changed from one `topicSamples` query per ranked topic to one batch call; embedding remains capped at TOP_KB (30) with concurrency limit 4.

## Concerns

- None known; response fields and 500 error behavior remain unchanged.

## Review round 1

- Expanded ranking fixtures to 31 topics and verified exactly 30 embedding/search calls, max embedding concurrency <=4, title probe fallback, and null KB fields beyond TOP_KB.
- Added embedding failure, KB search failure, and empty-ranking (topics[]) contracts.
- Verification: target tests 7 passed; full `pnpm vitest run tests/lib` — 74 files, 785 tests passed; typecheck and diff-check passed.
