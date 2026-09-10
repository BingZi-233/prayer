# Admin UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 参考 `BingZi-233/check-cx-admin`，完成 prayer 管理端全部页面的统一视觉、布局和响应式改造。

**Architecture:** 保留现有 Next.js 路由、服务端数据读取、客户端轮询和业务交互；以共享后台壳层和页面状态组件承载统一设计令牌，再按监控、运营、知识、系统四组逐页迁移。页面只消费 semantic shadcn tokens 和既有 UI primitives，不新增重复的页面级视觉系统。

**Tech Stack:** Next.js 16.3.4 App Router, React 19, Tailwind CSS v4, shadcn Base/Mira, lucide-react, Vitest, agent-browser/真实浏览器验证。

**Spec:** `docs/superpowers/specs/2026-09-10-admin-ui-redesign-design.md`

## Global Constraints

- 不改变 API、数据库 schema、认证、权限、轮询和业务交互语义。
- 使用 `components.json` 的 Base/Mira、lucide、`@/` alias 和 `app/globals.css`。
- 使用 semantic shadcn tokens，禁止页面散落 raw color；布局使用 `gap-*`，不使用 `space-x/y-*`。
- 对话框、Sheet、Drawer 必须包含可访问 Title；按钮图标使用 `data-icon`；卡片遵循完整 composition。
- 每组改造后运行相关测试和 `pnpm typecheck`；最终运行全量 check、独立构建、diff 检查与真实浏览器响应式验证。

### Task 1: Establish and verify shared shell baseline

**Files:**
- Modify: `app/globals.css`, `app/layout.tsx`, `app/admin/layout.tsx`
- Modify: `components/app-sidebar.tsx`, `components/admin/page-header.tsx`, `components/admin/page-shell.tsx`, `components/admin/section-card.tsx`
- Test: existing UI/admin tests discovered under `tests/` and `__tests__/`

- [ ] Review the current diff and preserve unrelated user changes.
- [ ] Normalize global surface tokens, typography, focus treatment, inset shell spacing, header alignment, sidebar groups and mobile collapse using existing Base/Mira primitives.
- [ ] Run `pnpm typecheck` and the affected tests; fix only regressions caused by the shell migration.
- [ ] Commit only the shared-shell files and their tests with `feat(ui): establish admin workspace shell` after verification.

### Task 2: Refresh login and monitoring pages

**Files:**
- Modify: `app/login/page.tsx`, `app/admin/page.tsx`, `app/admin/logs/page.tsx`
- Modify: `components/admin/stat.tsx`, `components/admin/data-state.tsx` when needed for these pages
- Test: existing admin/login tests; add focused tests beside current test conventions for state labels and empty/error rendering

- [ ] Write focused failing tests for the changed render contracts before implementation.
- [ ] Recompose login, runtime status and logs with shared header/card/table/status patterns; keep token submission and restart behavior unchanged.
- [ ] Verify the focused tests, then `pnpm typecheck`.
- [ ] Commit as `feat(ui): redesign login and monitoring pages`.

### Task 3: Refresh customer-operations pages

**Files:**
- Modify: `app/admin/sessions/page.tsx`, `app/admin/handoff/page.tsx`, `app/admin/proactive/page.tsx`
- Modify: `components/admin/master-detail.tsx`, `components/admin/item-card.tsx` when needed
- Test: existing sessions/handoff/proactive tests; add focused tests for mobile master-detail visibility and action states

- [ ] Write and run failing tests for the desired list/detail and action-state contracts.
- [ ] Migrate the three pages to the shared workbench layout, preserving live polling, selection, handoff and mutation semantics.
- [ ] Verify focused tests and `pnpm typecheck`.
- [ ] Commit as `feat(ui): redesign operations workbench`.

### Task 4: Refresh knowledge pages

**Files:**
- Modify: `app/admin/kb/page.tsx`, `app/admin/reflection/page.tsx`, `app/admin/ranking/page.tsx`
- Modify: relevant admin shared components only when a reusable state/layout defect is found
- Test: existing knowledge/reflection/ranking tests; add focused tests for table/empty/error state contracts

- [ ] Add failing tests for the page-level states and table grouping that change.
- [ ] Apply the shared content-page layout, semantic badges, table overflow boundaries and consistent empty/error/loading treatment.
- [ ] Verify focused tests and `pnpm typecheck`.
- [ ] Commit as `feat(ui): redesign knowledge pages`.

### Task 5: Refresh system pages

**Files:**
- Modify: `app/admin/config/page.tsx`, `app/admin/groups/page.tsx`, `app/admin/capabilities/page.tsx`, `app/admin/plugins/page.tsx`
- Modify: `components/admin/config/*.tsx` only where required to align shared form composition
- Test: existing configuration/groups/capabilities/plugins tests; add focused tests for tab/form/error contracts

- [ ] Add failing tests for changed tab, form, status and empty-state contracts.
- [ ] Migrate system pages to consistent settings sections, master-detail/list surfaces and semantic status treatments without changing save/reload behavior.
- [ ] Verify focused tests and `pnpm typecheck`.
- [ ] Commit as `feat(ui): redesign system pages`.

### Task 6: Cross-page responsive and runtime verification

**Files:**
- Modify: any page or shared component exposed by verification, limited to concrete defects
- Test: browser checks for every `/admin*` route and `/login`

- [ ] Start the development server using the project script and enumerate all routes from the current app tree.
- [ ] At 320px, 390px, 768px, 1024px and 1440px verify navigation, content width, table scroll boundaries, dialogs/sheets, dark mode and no unintended horizontal overflow.
- [ ] Run `pnpm check`, `NEXT_DIST_DIR=.next-verify pnpm build`, and `git diff --check`.
- [ ] Review the complete diff, explicitly list preserved unrelated files, and commit the final verification fixes as `fix(ui): close responsive admin gaps`.

