# Task 5 report — system pages

## Changed files

- `app/admin/groups/page.tsx` — enabled-chat table now uses `TableShell`; per-row 编辑策略 / 清除覆盖 collapsed into the shared `RowActions` menu; the destructive-ish action is separated by a divider. Toggle, policy override payload (`policyWritePayload`, clearing legacy bare group-id keys), and the editor sheet are unchanged.
- `app/admin/plugins/page.tsx` — plugin table now uses `TableShell`; 更新 / 卸载 collapsed into `RowActions` with the destructive variant on 卸载. Install form and enable/disable switches unchanged.
- `components/ui/dropdown-menu.tsx` — Base UI `Menu` wrapper added through the project's shadcn CLI (`base-mira` style). The CLI emitted a wrong `import { cn } from "cn"` and installed a bogus `cn` package; the import was corrected to `@/lib/utils` and the dependency reverted.
- `components/admin/row-actions.tsx` — shared row menu component (trigger is a ghost icon button labelled 行操作).
- `tests/ui/admin-system-contracts.test.ts` — contracts for the shared shell, the row menu, and preserved enable/policy/plugin/config semantics.

## Preserved business semantics

- Enable toggle still reads `enabledChats` from `/api/config`, rewrites the list, and PUTs it back; policy saves still send `{ groupPolicies }`; `clearPolicy` still restores global inheritance.
- Plugin actions still PATCH `{ action: "enable" | "disable" | "update" }` and DELETE by id.
- Config keeps the vertical settings tabs, category headers, and the 保存并生效 save path; capabilities keeps its tab set and probe refresh.

## Verification

- `pnpm vitest run tests/ui/admin-system-contracts.test.ts` — PASS (5 tests).
- `pnpm test` — PASS (90 files, 954 tests at time of commit).
- `pnpm typecheck` — PASS; `eslint` on every changed file — PASS.
- Browser: `/admin/groups`, `/admin/plugins`, `/admin/config`, `/admin/capabilities` at 390/768/1440 — no horizontal overflow; groups row menu opens with 编辑策略 / 清除覆盖 and 编辑策略 opens the policy sheet with its 3 fields; plugins page renders its empty state (no plugins installed in the preview DB).

## Unresolved risks

- The generated `dropdown-menu.tsx` is a full shadcn component; only the parts used by `RowActions` are exercised. Keyboard navigation was not exhaustively tested.
- A note previously written here claimed repo-wide lint failures were pre-existing; that was wrong. They were generated files under `.next-ui-dev/` leaking into `eslint` — fixed by the `.next*/**` ignore in `eslint.config.mjs`.
