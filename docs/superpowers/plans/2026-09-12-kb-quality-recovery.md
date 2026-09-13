# Knowledge-base Quality Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover high-frequency retrieval quality by restoring stable troubleshooting units and preventing reflection compaction from embedding oversized mixed-topic FAQs.

**Architecture:** Markdown remains the canonical retrieval layer under `docs/kb/retrieval`; provenance and hashes live under `docs/kb-audit`. Reflection compaction gains a pure output-normalization step that reuses the production 500-character splitter before vectors are written. Database ingestion stays a separately recorded operation and is not run by this plan.

**Tech Stack:** TypeScript, Vitest, SQLite/sqlite-vec, Xenova/bge-small-zh-v1.5, Python corpus audit, Markdown/YAML ledgers.

**Spec:** `docs/superpowers/specs/2026-09-12-kb-quality-recovery-design.md`

## Global Constraints

- Current knowledge belongs under `docs/kb/retrieval/`; `promoted/` remains historical.
- The real ingest reader is recursive over `docs/kb/**/*.md` and `**/*.txt`, blank-line splits, then hard-cuts at 500 characters.
- Active claims must have a verified primary source, retrieval date, and explicit volatility boundary.
- Never restore unsafe injection, secret disclosure, webview replacement, or permission-bypass procedures.
- Do not write SQLite/vector data or run `pnpm ingest` in this plan; record the ingest gate as unauthorized.

### Task 1: Capture the baseline and write the change ledger

**Files:**
- Create: `docs/kb-audit/2026-09-12-kb-quality-recovery.yaml`
- Create: `docs/kb-audit/2026-09-12-kb-quality-recovery.before/` (byte-preserving snapshots)
- Inspect: `docs/kb/retrieval/**/*.md`, `docs/kb/_archive/2026-09-11/original/**/*.md.disabled`

- [x] **Step 1: Record the current file list, sizes and SHA-256 values.**
  Run a read-only manifest command over `docs/kb/retrieval/**/*.md`; write the
  resulting paths, byte sizes and hashes to the ledger before any active file is
  edited.
- [x] **Step 2: Copy each file that will be updated into the dated snapshot.**
  Preserve relative paths and bytes under the snapshot directory; do not rename
  or rewrite the archived originals.
- [x] **Step 3: Record verified sources and decisions.**
  Put the official OpenAI and PackyAPI URLs, retrieved date, target paths,
  `source_status: verified`, and `ingest.authorized: false` in the YAML ledger.
- [x] **Step 4: Verify the ledger is outside the recursive ingest glob.**
  Run the production glob check and confirm that the YAML and snapshots cannot be
  read as active `.md` or `.txt` documents.

### Task 2: Add a tested reflection-output splitter

**Files:**
- Create: `lib/knowledge/reflection/compact-chunks.ts`
- Modify: `lib/knowledge/reflection/compactor.ts:320-329`
- Test: `tests/lib/knowledge/reflection/compact-chunks.test.ts`
- Test: `tests/lib/knowledge/reflection/compactor.test.ts`

**Interfaces:**
- `splitCompactedFaq(text: string, maxLen?: number): string[]` returns trimmed,
  non-empty chunks using the same paragraph and 500-character hard-cut rules as
  `scripts/ingest.ts`.
- `runCompact` embeds every returned chunk and stores all chunks in order; it
  never embeds an oversized merged FAQ as one vector.

- [x] **Step 1: Write the failing unit tests.**
  Cover paragraph splitting, hard cutting at 500 characters, preservation of
  text order, and empty/whitespace input returning an empty array. Add a
  compactor test whose fake LLM returns one 1,200-character FAQ and assert that
  the repository receives three content chunks rather than one.
- [x] **Step 2: Run only the new tests and confirm the expected failures.**
  Run `pnpm vitest run tests/lib/knowledge/reflection/compact-chunks.test.ts tests/lib/knowledge/reflection/compactor.test.ts` and verify the failure is the missing splitter behavior, not test setup.
- [x] **Step 3: Implement the minimal pure splitter.**
  Match `chunkText` semantics exactly: split on blank lines, trim/filter, and
  hard-cut paragraphs above 500 characters without inventing content.
- [x] **Step 4: Route compactor output through the splitter before embedding.**
  Flatten FAQ outputs in order, skip only empty strings, and retain the existing
  before/after compaction snapshot of the un-split FAQ list for auditability.
- [x] **Step 5: Run the focused tests and the reflection repository tests.**
  Confirm all existing compactor expectations remain green and vector/chunk counts
  match the new behavior.

### Task 3: Restore P0 canonical knowledge units

**Files:**
- Modify: `docs/kb/retrieval/faq/codex.md`
- Modify: `docs/kb/retrieval/foundation/network.md`
- Modify: `docs/kb/retrieval/ccswitch/cli.md`
- Modify: `docs/kb/retrieval/foundation/billing.md`
- Create: `docs/kb/retrieval/foundation/session-context.md`
- Create: `docs/kb/retrieval/image/client-errors.md`

- [x] **Step 1: Patch Codex authentication and protocol units.**
  Add self-contained units for ChatGPT login versus API-key login, `codex login
  status`, config/auth separation, Responses versus Chat endpoints, error-class
  evidence, and the rule to use current model/group lookup rather than frozen IDs.
- [x] **Step 2: Patch network and endpoint diagnosis.**
  Add host/`/v1`/resource-path distinctions, actual-URL inspection, proxy/DNS/TLS
  layering, one-variable-at-a-time testing, and request-id evidence. Keep endpoint
  values live-lookup and cite PackyAPI’s official configuration pages.
- [x] **Step 3: Patch CC Switch persistence checks.**
  Add provider selection, environment-conflict checks, full process restart, short
  request verification, and separate-app configuration boundaries. Do not include
  shell installers or secret-bearing examples.
- [x] **Step 4: Patch billing and add session/context guidance.**
  Add evidence-based usage reconciliation, auxiliary-call caveats, cache/context
  boundaries and new-session rules without freezing prices, quotas or cache TTLs.
- [x] **Step 5: Add image-client error units.**
  Cover Images generations versus edits, multipart/reference-image boundaries, and
  `Failed to fetch` diagnosis; cite official OpenAI image documentation and keep
  provider-specific model/parameter values live-lookup.
- [x] **Step 6: Run the Markdown structural audit before proceeding.**
  Use the actual recursive `.md`/`.txt` globs, active root and 500-character
  limits; fix every new error before embedding validation.

### Task 4: Validate tokenizer, embedding and historical retrieval behavior

**Files:**
- Create: `docs/kb-audit/2026-09-12-kb-quality-recovery.validation.yaml`
- Create: `scripts/audit-kb-quality-recovery.ts`
- Test: `tests/scripts/audit-kb-quality-recovery.test.ts`

- [x] **Step 1: Write the failing audit test.**
  Feed the audit a fixture containing an oversized FAQ and a stale-path duplicate;
  assert that it reports both problems and does not claim PASS.
- [x] **Step 2: Implement the read-only audit helper.**
  Reuse the production splitter, tokenizer and embedding call shape; report chunk
  ranges, token counts, finite 512-dimensional vectors, top-5 source paths, and
  dynamic-reflection contamination for representative historical queries.
- [x] **Step 3: Run the fixture test, then the real audit.**
  Use queries covering API errors, Codex configuration, CC Switch, base_url,
  billing, invoice and image failures; compare top-5 results with the pre-change
  baseline recorded in the report.
- [x] **Step 4: Record results and remaining partials.**
  Keep any unavailable live source or database-index result marked `partial`; do
  not imply that Markdown validation rebuilt production vectors.

### Task 5: Handoff and ingestion gate

**Files:**
- Modify: `docs/kb-audit/2026-09-12-kb-quality-recovery.yaml`
- Create: `docs/kb-audit/2026-09-12-kb-quality-recovery.after/` (post-edit hashes)

- [x] **Step 1: Record after hashes and file/chunk/token counts.**
- [x] **Step 2: Run the full recursive boundary audit and focused tests.**
- [x] **Step 3: Confirm the working tree contains no unintended edits.**
- [x] **Step 4: Leave `ingest.authorized: false, executed: false` and report the
  exact command that would be run after explicit authorization.**
