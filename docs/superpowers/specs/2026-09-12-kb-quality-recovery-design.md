# Knowledge-base quality recovery design

**Date:** 2026-09-12
**Scope:** `docs/kb/retrieval` plus the reflection compaction path; production
SQLite/vector data is not changed by the file/code work.

## Problem

Historical questions show a concentration around API errors, Codex/client
configuration, endpoint selection, CC Switch persistence, billing evidence and
image-client failures. The curated corpus has become too generic after the
September cleanup, while the production index is stale relative to the current
retrieval tree. Separately, reflection compaction emits large merged FAQs that
are embedded as single vectors; these entries can outrank canonical documents and
carry volatile or unrelated facts.

## Goal

Restore high-frequency, stable troubleshooting knowledge without reintroducing
volatile model/group/price snapshots or unsafe procedures, and make reflection
compaction preserve production retrieval boundaries.

## Design

1. Keep `docs/kb/retrieval/` as the only current canonical Markdown subtree.
   Add self-contained units for Codex authentication/protocol errors, endpoint
   and network diagnosis, CC Switch effective-configuration checks, billing and
   session/context evidence, and image-client protocol boundaries. Each unit
   carries an authoritative source URL, retrieval date, and a live-lookup
   boundary where values can change.
2. Preserve old bytes and hashes in a manifest under `docs/kb-audit/`; do not
   restore archived files wholesale. Unsafe injection, secret-handling,
   webview-replacement, and bypass instructions remain disabled.
3. Add a production-shaped reflection-output splitter. Every compacted FAQ is
   split with the same blank-line/500-character rule used by ingest before it is
   embedded and stored. The splitter is pure and unit-tested; an FAQ that has no
   usable text remains unchanged rather than being silently dropped.
4. Keep ingestion as a separate operation. This change records
   `authorized: false, executed: false` in its ledger until the user explicitly
   authorizes the database rebuild.

The recovery batch also adds a focused API-error FAQ and strengthens the
Codex/CC Switch client-specific units so mixed historical queries do not fall
through to unrelated client pages. These are stable troubleshooting procedures;
model, group, price, quota and status values remain live-lookup.

## Sources

- Official OpenAI Codex authentication and CLI pages:
  `https://learn.chatgpt.com/docs/auth` and
  `https://developers.openai.com/codex/cli`.
- PackyAPI official Codex, quick-start, FAQ and image documentation under
  `https://docs.packyapi.ai/`.
- Existing canonical legal and security pages in `docs/kb/retrieval/` are
  retained; no current price, group, model, status, quota or announcement is
  frozen into a new unit.

## Acceptance criteria

- Active corpus passes the real recursive ingest-boundary audit with no disabled
  artifacts visible to the glob.
- New units remain self-contained after the production splitter and stay within
  the established character/token targets.
- Reflection compaction tests prove that long LLM output is split before
  embedding and that empty output never causes data loss.
- Production-shaped tokenizer/embedding smoke records 512-dimensional vectors
  and top-5 results for representative historical queries.
- No `pnpm ingest`, API ingest, or SQLite/vector write occurs in this phase.
