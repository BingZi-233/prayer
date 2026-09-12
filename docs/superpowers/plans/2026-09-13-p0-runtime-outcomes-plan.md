# P0 Runtime Outcome Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用确定性的最终文本选择、主动候选预算和持久化 outbox，消除当前运行记录中的误答、静默丢失、无限候选和虚假成功。

**Architecture:** 先在模型流消费层建立共享的最终文本状态机并暴露 Agent 状态；再在主动轮询层引入三态判定和硬候选预算。最后以 v9 SQLite outbox 为发送前的事实源，registry 负责原子 claim、重试和 delivery 事件，统计仓储只把成功投递计入自动/主动解决率。

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Node EventEmitter bus, existing channel adapters.

**Spec:** `docs/superpowers/specs/2026-09-13-p0-runtime-outcomes-design.md`

## Global Constraints

- 不增加模型调用或依赖新的模型能力；状态机、预算、幂等和重试必须由代码实现。
- 迁移只能追加版本；旧表新增 delivery 列默认 `sent`，不得删除或重写历史记录。
- 每个生产代码行为先有会失败的测试；每项任务独立运行相关 Vitest 后才提交。
- 保留现有工作区中与 KB 质量恢复相关的用户改动，不修改其文件。
- 通道发送失败必须以 rejected Promise 传播到 registry；不得用“记录日志后返回成功”代替。

---

### Task 1: Final assistant text and Agent status

**Files:**
- Create: `lib/model/final-text.ts`
- Modify: `lib/model/drain.ts`
- Modify: `lib/conversation/agent.ts`
- Test: `tests/lib/model/drain.test.ts` (create if absent)
- Test: `tests/lib/conversation/agent.test.ts`

**Interfaces:**
- Produces `consumeAssistantContent(state, blocks): void` and `finalAssistantText(state): string` in `lib/model/final-text.ts`.
- Produces `AgentResult.status: "success" | "partial" | "failed"`.
- Keeps `drainQuery(...).text` and existing structured-output behavior unchanged for streams without tool boundaries.

- [ ] **Step 1: Write the failing tests**

Add tests that feed an assistant draft, a `tool_use`, and a final assistant text and assert only the final text is returned; add an Agent test asserting a thrown iterator returns `failed`, while an iterator that emits text then throws returns `partial`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/lib/model/drain.test.ts tests/lib/conversation/agent.test.ts`
Expected: FAIL because the current implementation concatenates draft text and has no `status`.

- [ ] **Step 3: Implement the minimal shared accumulator**

Implement the state machine from the spec, replace the direct `text +=` loops in `drainQuery` and `Agent.run`, and set `AgentResult.status` in the normal, partial-error, and fallback-error paths.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm vitest run tests/lib/model/drain.test.ts tests/lib/conversation/agent.test.ts && pnpm exec tsc --noEmit`
Expected: PASS and typecheck succeeds.

- [ ] **Step 5: Commit**

```bash
git add lib/model/final-text.ts lib/model/drain.ts lib/conversation/agent.ts tests/lib/model/drain.test.ts tests/lib/conversation/agent.test.ts
git commit -m "fix: select final assistant text and expose run status"
```

### Task 2: Tri-state proactive classifier and candidate budget

**Files:**
- Modify: `lib/conversation/answerability.ts`
- Modify: `lib/conversation/pollers/unanswered.ts`
- Modify: `lib/conversation/assemble.ts`
- Modify: `lib/runtime.ts`
- Modify: `lib/core/config/schema.ts`
- Test: `tests/lib/conversation/answerability.test.ts`
- Test: `tests/lib/conversation/pollers/unanswered.test.ts`
- Test: `tests/lib/core/config/schema.test.ts` (or the existing config schema test file)

**Interfaces:**
- Produces `AnswerabilityDecision`, `AnswerabilityResult`, and a classifier returning `Promise<AnswerabilityResult>`.
- Adds `proactiveCandidateBudget` to `AppConfig` with default `12`; `AssembleDeps` and runtime wiring pass it as `maxCandidatesPerScan`.
- `runScan` leaves the per-chat cursor unchanged on classifier error or `AgentResult.status !== "success"`.

- [ ] **Step 1: Write failing classifier and poller tests**

Assert parsed true/false map to `answerable`/`not_answerable`, thrown/timeout calls map to `error`, a classifier error does not advance the cursor, and a stream of non-answerable candidates stops at the configured candidate budget.

- [ ] **Step 2: Run focused tests to observe failure**

Run: `pnpm vitest run tests/lib/conversation/answerability.test.ts tests/lib/conversation/pollers/unanswered.test.ts tests/lib/core/config/schema.test.ts`
Expected: FAIL because the classifier is boolean-only and the poller has no candidate budget/error branch.

- [ ] **Step 3: Implement tri-state and guardrails**

Return typed decisions with sanitized reasons, count candidates before expensive classification, stop and retain the cursor on errors/partial agent results, and clamp the resolved budget to at least `maxPerScan` and at least `1`.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm vitest run tests/lib/conversation/answerability.test.ts tests/lib/conversation/pollers/unanswered.test.ts tests/lib/core/config/schema.test.ts && pnpm exec tsc --noEmit`
Expected: PASS and typecheck succeeds.

- [ ] **Step 5: Commit**

```bash
git add lib/conversation/answerability.ts lib/conversation/pollers/unanswered.ts lib/conversation/assemble.ts lib/runtime.ts lib/core/config/schema.ts tests/lib/conversation/answerability.test.ts tests/lib/conversation/pollers/unanswered.test.ts tests/lib/core/config/schema.test.ts
git commit -m "fix: bound proactive candidates and preserve retryable errors"
```

### Task 3: Durable outbox and delivery-aware accounting

**Files:**
- Create: `lib/core/chat/outbox.ts`
- Create: `lib/core/db/repositories/outbox.ts`
- Create: `lib/conversation/delivery-recorder.ts`
- Modify: `lib/core/chat/events.ts`
- Modify: `lib/conversation/reply-mapper.ts`
- Modify: `lib/conversation/orchestrator.ts`
- Modify: `lib/conversation/pollers/unanswered.ts`
- Modify: `lib/conversation/resolution-recorder.ts`
- Modify: `lib/core/db/repo.ts`
- Modify: `lib/core/db/repositories/proactive.ts`
- Modify: `lib/core/db/repositories/statistics.ts`
- Modify: `lib/core/db/rows.ts`
- Modify: `lib/core/db/migrations/schema.ts`
- Modify: `lib/core/db/migrations/registry.ts`
- Modify: `lib/core/db/migrations/index.ts`
- Modify: `lib/channels/registry.ts`
- Modify: `lib/channels/qq/client.ts`
- Modify: `lib/channels/qq/index.ts`
- Modify: `lib/channels/tg/client.ts`
- Modify: `lib/runtime.ts`
- Modify: `lib/conversation/assemble.ts`
- Tests: `tests/lib/core/db/migrations.test.ts`, `tests/lib/core/db/repo.stats.test.ts`, `tests/lib/core/db/outbox.test.ts`, `tests/lib/channels/registry.test.ts`, `tests/lib/channels/qq/client.test.ts`, `tests/lib/conversation/reply-mapper.test.ts`, `tests/lib/conversation/delivery-recorder.test.ts`.

**Interfaces:**
- `OutboundStore.enqueueAndClaim(action, now): OutboxRecord | null`, `claimDue(limit, now): OutboxRecord[]`, `markSent(id, now)`, `markFailed(id, error, nextAttemptAt)`, and `sentChunkCount(resolutionKey): number`; records include a reclaimable `leaseUntil`.
- `ChannelRegistry({ outbox?, retryMs?, now? })` remains constructible with no arguments; when an outbox is supplied it owns the retry timer and emits `delivery.recorded`.
- `EventMap` gains `delivery.planned` and `delivery.recorded`; `ReplyReady`/`ActionSend` gain optional `deliveryKey`, `resolutionKey`, `chunkIndex`, and `chunkCount`.
- v9 is the current schema and adds `outbox_messages` (including a lease), delivery columns/statuses/expected counts, and non-null delivery-key uniqueness.

- [ ] **Step 1: Add failing schema/repository and registry tests**

Test v9 creates the outbox and delivery columns, duplicate `deliveryKey` inserts one row, failed sends are retained with attempts/backoff, and a later retry marks the same row sent. Test a disconnected QQ/TG send rejects instead of resolving.

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `pnpm vitest run tests/lib/core/db/migrations.test.ts tests/lib/core/db/repo.stats.test.ts tests/lib/channels/registry.test.ts tests/lib/channels/qq/client.test.ts`
Expected: FAIL because v9, outbox storage, and rejection semantics do not exist.

- [ ] **Step 3: Implement v9 storage and OutboundStore**

Append the migration, add the repository and Repo facade, use idempotent SQL, and preserve historical rows with `delivery_status='sent'`.

- [ ] **Step 4: Implement registry claim/retry and channel rejection**

Persist before `channel.send`, mark success/failure, retry due rows with bounded exponential backoff, clear timers on stop, and make QQ/Telegram propagate transport failures.

- [ ] **Step 5: Wire delivery metadata and accounting**

Generate stable keys at orchestrator/poller boundaries, propagate chunk keys in the mapper, emit the planned chunk count before actions, write pending resolution/proactive rows, and update them through `delivery-recorder` so only all-chunks-sent auto/proactive events count.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `pnpm vitest run tests/lib/core/db/migrations.test.ts tests/lib/core/db/repo.stats.test.ts tests/lib/channels/registry.test.ts tests/lib/channels/qq/client.test.ts tests/lib/conversation/reply-mapper.test.ts tests/lib/conversation/orchestrator.test.ts tests/lib/conversation/pollers/unanswered.test.ts && pnpm exec tsc --noEmit`
Expected: PASS and typecheck succeeds.

- [ ] **Step 7: Commit**

```bash
git add lib/core/chat/outbox.ts lib/core/db/repositories/outbox.ts lib/conversation/delivery-recorder.ts lib/core/chat/events.ts lib/conversation/reply-mapper.ts lib/conversation/orchestrator.ts lib/conversation/pollers/unanswered.ts lib/conversation/resolution-recorder.ts lib/core/db/repo.ts lib/core/db/repositories/proactive.ts lib/core/db/repositories/statistics.ts lib/core/db/rows.ts lib/core/db/migrations/schema.ts lib/core/db/migrations/registry.ts lib/core/db/migrations/index.ts lib/channels/registry.ts lib/channels/qq/client.ts lib/channels/qq/index.ts lib/channels/tg/client.ts lib/runtime.ts lib/conversation/assemble.ts tests
git commit -m "feat: persist outbound delivery outcomes and retries"
```

### Task 4: Whole-branch verification

**Files:**
- Modify: files named by the final review, with a regression test beside each behavior change.

- [ ] **Step 1: Run the complete verification suite**

Run: `pnpm check`
Expected: typecheck succeeds, ESLint has no new errors, and all Vitest tests pass.

- [ ] **Step 2: Inspect the final diff and migration status**

Run: `git diff --stat HEAD~3..HEAD`, `git status --short`, and a fresh in-memory migration test. Confirm no KB user files were modified.

- [ ] **Step 3: Commit any narrowly scoped verification fixes**

Use a separate commit with the failing test and fix included; do not amend unrelated user commits.
