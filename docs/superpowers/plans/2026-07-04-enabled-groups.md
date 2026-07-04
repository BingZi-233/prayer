# 生效群白名单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 `enabledGroups` 白名单，仅列表内的群参与回复/缓冲/沉淀，其余群 bot 完全无视；空名单=全关；管理群永远豁免。

**Architecture:** config 字段 `enabledGroups: number[]` 经 `assemble` deps 透传给 gateway / message-buffer / reflection-poller，各自建 `Set` 做 O(1) 成员判断。改名单走现有 PUT `/api/config` → `reconfigure` 重启管线。

**Tech Stack:** TypeScript, Next.js App Router, better-sqlite3 (Repo), vitest, zod, shadcn/ui。

**测试运行前缀：** 本仓库用 pnpm + vitest。单文件跑：`pnpm vitest run <path>`。

---

### Task 1: config-store 加 `enabledGroups` 字段

**Files:**
- Modify: `lib/config-store.ts`
- Test: `tests/lib/config-store.test.ts`

- [ ] **Step 1: 写失败测试**

追加到 `tests/lib/config-store.test.ts` 的 `describe("config-store", …)` 块内：

```ts
it("enabledGroups 默认空数组", () => {
  const repo = mkRepo();
  const cfg = getConfig(repo, { ONEBOT_WS_URL: "ws://x:1", BOT_QQ: "1", ADMIN_GROUP_ID: "2" });
  expect(cfg.enabledGroups).toEqual([]);
});

it("旧库缺 enabledGroups 补空数组;setConfig 可写入", () => {
  const repo = mkRepo();
  repo.setConfigRow("app", JSON.stringify({ botQQ: 5 }));
  expect(getConfig(repo, {}).enabledGroups).toEqual([]); // 缺失补默认
  setConfig(repo, { enabledGroups: [100, 200] });
  expect(getConfig(repo, {}).enabledGroups).toEqual([100, 200]); // 存储值优先
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run tests/lib/config-store.test.ts`
Expected: FAIL（`enabledGroups` 为 `undefined`，`toEqual([])` 不通过）。

- [ ] **Step 3: 实现**

在 `lib/config-store.ts` 的 `AppConfig` interface 末尾（`reflectWindowMax: number;` 之后）加：

```ts
  enabledGroups: number[];
```

在 `seedFromEnv` 返回对象末尾（`reflectWindowMax: …` 之后）加：

```ts
    enabledGroups: [],
```

（不从 env 读取，纯 UI 管理；空=全关。旧库缺字段由现有 `{ ...seedFromEnv(env), ...JSON.parse(raw) }` merge 自动补 `[]`。）

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run tests/lib/config-store.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: 提交**

```bash
git add lib/config-store.ts tests/lib/config-store.test.ts
git commit -m "feat(config): AppConfig 加 enabledGroups 字段(默认空)"
```

---

### Task 2: gateway 门控非生效群

**Files:**
- Modify: `lib/agent/gateway.ts`
- Test: `tests/lib/agent/gateway.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/lib/agent/gateway.test.ts` 顶部 `beforeEach` 当前是：

```ts
beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:"));
  registerGateway({ repo, botQQ: BOT, adminGroupId: 999 });
});
```

改为传入 `enabledGroups`（现有用例群号为 1，故白名单含 1）：

```ts
beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:"));
  registerGateway({ repo, botQQ: BOT, adminGroupId: 999, enabledGroups: [1] });
});
```

在 `describe("gateway", …)` 块内追加两条用例：

```ts
it("非生效群 @bot 不触发", async () => {
  const spy = vi.fn();
  bus.on("message.qualified", spy);
  bus.emit("message.received", { groupId: 777, userId: 2, messageId: 30, rawText: "订单在哪", atList: [BOT] });
  await new Promise((r) => setTimeout(r, 50));
  expect(spy).not.toHaveBeenCalled();
});

it("非生效群不影响管理群命令(adminGroup 豁免)", async () => {
  repo.setSessionId("1:2", "sid-old");
  const p = new Promise<any>((res) => bus.once("action.send", res));
  // adminGroupId=999 不在 enabledGroups,命令仍须工作
  bus.emit("message.received", { groupId: 999, userId: 7, messageId: 31, rawText: "!reset 1:2", atList: [BOT] });
  const a = await p;
  expect(a.groupId).toBe(999);
  expect(repo.getResumeId("1:2")).toBeUndefined();
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run tests/lib/agent/gateway.test.ts`
Expected: FAIL —— "非生效群 @bot 不触发" 失败（当前无门控，777 群会 emit qualified，spy 被调用）。类型上 `enabledGroups` 也会报缺字段。

- [ ] **Step 3: 实现**

`lib/agent/gateway.ts`：`GatewayDeps` 加字段：

```ts
export interface GatewayDeps {
  repo: Repo;
  botQQ: number;
  adminGroupId: number;
  enabledGroups: number[];
}
```

`registerGateway` 函数体解构与建 Set：

```ts
export function registerGateway(deps: GatewayDeps): () => void {
  const { repo, botQQ, adminGroupId, enabledGroups } = deps;
  const enabled = new Set(enabledGroups);
```

`onReceived` 函数体首行（在 `// 管理群命令优先` 注释之前）加门：

```ts
  const onReceived = (msg: IncomingMessage) => {
    // 生效群门:非生效群且非管理群 → 完全忽略
    if (msg.groupId !== adminGroupId && !enabled.has(msg.groupId)) return;

    // 管理群命令优先
    if (msg.groupId === adminGroupId) {
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run tests/lib/agent/gateway.test.ts`
Expected: PASS（含既有用例，因群号 1 已入白名单）。

- [ ] **Step 5: 提交**

```bash
git add lib/agent/gateway.ts tests/lib/agent/gateway.test.ts
git commit -m "feat(gateway): 非生效群完全忽略,管理群豁免"
```

---

### Task 3: message-buffer 门控非生效群

**Files:**
- Modify: `lib/agent/message-buffer.ts`
- Test: `tests/lib/agent/message-buffer.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/lib/agent/message-buffer.test.ts`：现有用例默认群号 100（见 `msg()` helper），故注册时白名单含 100。在 `describe("message-buffer", …)` 块内追加：

```ts
it("非生效群消息不落库", () => {
  const stop = registerMessageBuffer({ repo, botQQ: 1, adminGroupId: 999, enabledGroups: [100] });
  bus.emit("message.received", msg({ groupId: 888, rawText: "非生效群" }));
  expect(repo.groupMessageWindow(888, 0, 10)).toHaveLength(0);
  stop();
});
```

并把该文件已有三条用例里的 `registerMessageBuffer({ repo, botQQ: 1, adminGroupId: 999 })` 全部改为带 `enabledGroups: [100]`：

```ts
registerMessageBuffer({ repo, botQQ: 1, adminGroupId: 999, enabledGroups: [100] });
```

（共 3 处：`普通用户群消息落库` / `排除管理群…` / `teardown 后不再落库`。）

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run tests/lib/agent/message-buffer.test.ts`
Expected: FAIL —— 类型报 `MessageBufferDeps` 缺 `enabledGroups`；新用例逻辑亦未实现。

- [ ] **Step 3: 实现**

`lib/agent/message-buffer.ts`：`MessageBufferDeps` 加字段：

```ts
export interface MessageBufferDeps {
  repo: Repo;
  botQQ: number;
  adminGroupId: number;
  enabledGroups: number[];
}
```

`registerMessageBuffer` 解构与建 Set，并在现有 adminGroup/bot/空文本过滤之后加门：

```ts
export function registerMessageBuffer(deps: MessageBufferDeps): () => void {
  const { repo, botQQ, adminGroupId, enabledGroups } = deps;
  const enabled = new Set(enabledGroups);

  const onReceived = (msg: IncomingMessage) => {
    if (msg.groupId === adminGroupId) return;
    if (msg.userId === botQQ) return;
    if (!msg.rawText?.trim()) return;
    if (!enabled.has(msg.groupId)) return; // 生效群门:非生效群不缓冲
    try {
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run tests/lib/agent/message-buffer.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/agent/message-buffer.ts tests/lib/agent/message-buffer.test.ts
git commit -m "feat(message-buffer): 非生效群不缓冲"
```

---

### Task 4: reflection-poller 门控非生效群

**Files:**
- Modify: `lib/agent/reflection-poller.ts`
- Test: `tests/lib/agent/reflection-poller.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/lib/agent/reflection-poller.test.ts`：现有 `opts()` helper 无 `enabledGroups`，现有用例群号 100。追加白名单默认，并加一条"非生效群即使有 buffer 行也跳过"用例。

先在 `opts` 的默认对象里加 `enabledGroups: [100]`（放在 `windowMax: 60,` 之后）：

```ts
const opts = (over: Record<string, unknown> = {}) => ({
  repo,
  adminGroupId: 999,
  embed,
  now: () => NOW,
  scanMs: 1,
  lookbackMs: 1_000_000,
  settleMs: 1000,
  windowMax: 60,
  enabledGroups: [100],
  ...over,
});
```

在 `describe("reflection-poller runScan", …)` 块内追加：

```ts
it("非生效群即使有已沉降管理发言也跳过,不调用 LLM,游标不动", async () => {
  seed(100, 200, "member", "退款多久?", NOW - 5000);
  seed(100, 201, "admin", "3 个工作日", NOW - 4000);
  const qf = vi.fn(fakeQuery("[]"));
  // 白名单不含 100
  await runScan(opts({ enabledGroups: [], queryFn: qf as never }));
  expect(qf).not.toHaveBeenCalled();
  expect(repo.groupReflectCursor(100)).toBe(0); // 游标不推进
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run tests/lib/agent/reflection-poller.test.ts`
Expected: FAIL —— 类型报 `ReflectionPollerDeps` 缺 `enabledGroups`;新用例中 `qf` 被调用(当前无门控)。

- [ ] **Step 3: 实现**

`lib/agent/reflection-poller.ts`：

`ReflectionPollerDeps` interface 加字段（`windowMax?: number;` 之后）：

```ts
  enabledGroups?: number[];
```

`Resolved` interface 加字段（`windowMax: number;` 之后）：

```ts
  enabledGroups: number[];
```

`resolve()` 返回对象加（`windowMax: deps.windowMax ?? 60,` 之后）：

```ts
    enabledGroups: deps.enabledGroups ?? [],
```

`scanOnce` 内建 Set 并在群循环首行拦截：

```ts
async function scanOnce(d: Resolved): Promise<void> {
  const now = d.now();
  const until = now - d.settleMs;
  if (until <= 0) return;

  const enabled = new Set(d.enabledGroups);
  for (const groupId of d.repo.groupsWithAdminMessagesUpTo(until)) {
    if (!enabled.has(groupId)) continue; // 生效群门:非生效群不沉淀
    const cursor = d.repo.groupReflectCursor(groupId);
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run tests/lib/agent/reflection-poller.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/agent/reflection-poller.ts tests/lib/agent/reflection-poller.test.ts
git commit -m "feat(reflection): 非生效群不沉淀(纵深防御)"
```

---

### Task 5: assemble + runtime 透传 enabledGroups

**Files:**
- Modify: `lib/assemble.ts`, `lib/runtime.ts`
- Test: 靠既有 `tests/lib/runtime.test.ts` + 全量回归（无新增单测；本任务为纯接线，编译与既有测试即验证）

- [ ] **Step 1: 修改 assemble**

`lib/assemble.ts`：`AssembleDeps` 加字段（`agent: Agent;` 之后）：

```ts
export interface AssembleDeps {
  repo: Repo;
  botQQ: number;
  adminGroupId: number;
  enabledGroups: number[];
  agent: Agent;
  reflectScanMs?: number;
  reflectLookbackMs?: number;
  reflectSettleMs?: number;
  reflectWindowMax?: number;
}
```

`assemble` 函数体解构与透传：

```ts
export function assemble(deps: AssembleDeps): () => void {
  const { repo, botQQ, adminGroupId, enabledGroups, agent } = deps;
  const cleanups = [
    registerErrorHandler(),
    registerGateway({ repo, botQQ, adminGroupId, enabledGroups }),
    registerOrchestrator({ agent, store: new SessionStore(repo) }),
    registerReplyMapper(),
    registerMessageBuffer({ repo, botQQ, adminGroupId, enabledGroups }),
    registerReflectionPoller({
      repo,
      adminGroupId,
      enabledGroups,
      scanMs: deps.reflectScanMs,
      lookbackMs: deps.reflectLookbackMs,
      settleMs: deps.reflectSettleMs,
      windowMax: deps.reflectWindowMax,
    }),
  ];
  return () => cleanups.forEach((c) => c());
}
```

- [ ] **Step 2: 修改 runtime**

`lib/runtime.ts` 的 `start()` 内 `this.teardown = builders.assemble({ … })` 调用加 `enabledGroups`（`adminGroupId: cfg.adminGroupId,` 之后）：

```ts
      this.teardown = builders.assemble({
        repo,
        botQQ: cfg.botQQ,
        adminGroupId: cfg.adminGroupId,
        enabledGroups: cfg.enabledGroups,
        agent,
        reflectScanMs: cfg.reflectScanMs,
        reflectLookbackMs: cfg.reflectLookbackMs,
        reflectSettleMs: cfg.reflectSettleMs,
        reflectWindowMax: cfg.reflectWindowMax,
      });
```

- [ ] **Step 3: 运行验证(编译 + 既有测试回归)**

Run: `pnpm vitest run tests/lib/runtime.test.ts tests/lib/agent/gateway.test.ts tests/lib/agent/message-buffer.test.ts tests/lib/agent/reflection-poller.test.ts`
Expected: PASS。若 `tests/lib/runtime.test.ts` 用假 `assemble`/假 cfg，检查其 cfg 是否需补 `enabledGroups`；如报缺字段，给该测试的 cfg 对象补 `enabledGroups: []`。

- [ ] **Step 4: 提交**

```bash
git add lib/assemble.ts lib/runtime.ts tests/lib/runtime.test.ts
git commit -m "feat(runtime): 透传 enabledGroups 至全链路"
```

---

### Task 6: config API 接受 enabledGroups

**Files:**
- Modify: `app/api/config/route.ts`
- Test: `tests/lib/api.test.ts`（若含 config PUT 校验）；否则本任务靠 zod schema 手工验证 + 编译

- [ ] **Step 1: 查是否已有 config PUT 测试**

Run: `grep -n "patchSchema\|enabledGroups\|PUT" tests/lib/api.test.ts`
Expected: 了解是否有针对 `/api/config` 的测试。若有 schema 级测试，按其风格加 `enabledGroups` 用例；若无，跳过测试新增，仅改 schema。

- [ ] **Step 2: 实现**

`app/api/config/route.ts` 的 `patchSchema` 加字段（`model: z.string().optional(),` 之后）：

```ts
const patchSchema = z.object({
  onebotWsUrl: z.string().optional(),
  onebotAccessToken: z.string().optional(),
  botQQ: z.number().optional(),
  adminGroupId: z.number().optional(),
  handoffTimeoutMin: z.number().optional(),
  dbPath: z.string().optional(),
  claudeConfigDir: z.string().optional(),
  model: z.string().optional(),
  enabledGroups: z.array(z.number()).optional(),
});
```

（`maskConfig` 无需改：`enabledGroups` 非密钥，透传即可。）

- [ ] **Step 3: 验证**

Run: `pnpm vitest run tests/lib/api.test.ts`
Expected: PASS（既有用例不受影响；如新增了 enabledGroups 用例则一并通过）。

- [ ] **Step 4: 提交**

```bash
git add app/api/config/route.ts tests/lib/api.test.ts
git commit -m "feat(api): config PUT 接受 enabledGroups 数组"
```

---

### Task 7: 管理后台 config 页加「生效群」编辑器

**Files:**
- Modify: `app/admin/config/page.tsx`
- Test: 无自动化 UI 测试（本仓库 config 页无测试）；靠 `pnpm build` 编译 + 手工冒烟

- [ ] **Step 1: 扩展 Cfg 接口**

`app/admin/config/page.tsx` 的 `Cfg` interface 加字段（`model: string;` 之后）：

```ts
interface Cfg {
  onebotWsUrl: string;
  onebotAccessToken: string;
  botQQ: number;
  adminGroupId: number;
  handoffTimeoutMin: number;
  dbPath: string;
  claudeConfigDir: string;
  model: string;
  enabledGroups: number[];
}
```

- [ ] **Step 2: 加逗号/换行分隔解析 helper 与 UI**

在组件内 `const num = (k: keyof Cfg) => …;` 之后加解析/序列化 helper：

```ts
  // 生效群:UI 用换行/逗号分隔文本,存 number[]
  const groupsText = cfg ? cfg.enabledGroups.join("\n") : "";
  function updGroups(v: string) {
    if (!cfg) return;
    const ids = v
      .split(/[\s,]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    setCfg({ ...cfg, enabledGroups: Array.from(new Set(ids)) });
  }
```

在 OneBot tab 的 `FieldGroup` 内、`adminGroupId` 的 `<Field>` 之后加：

```tsx
                  <Field>
                    <FieldLabel htmlFor="enabledGroups">生效群</FieldLabel>
                    <textarea
                      id="enabledGroups"
                      className="border-input bg-transparent min-h-24 rounded-md border px-3 py-2 text-sm shadow-xs"
                      value={groupsText}
                      placeholder="每行一个群号,或逗号分隔"
                      onChange={(e) => updGroups(e.target.value)}
                    />
                    <FieldDescription>
                      仅这些群里 bot 才会回复 / 缓冲 / 沉淀知识。留空 = 对所有群都不响应。管理群不受此列表影响。
                    </FieldDescription>
                  </Field>
```

（注：`enabledGroups` 不经 `upd()`/`NUM_KEYS`,单独用 `updGroups`。`save()` 的 payload 是 `{ ...cfg }`,已含 `enabledGroups`,无需改 save。）

- [ ] **Step 3: 编译验证**

Run: `pnpm build`
Expected: 构建成功，无 TS 报错。

- [ ] **Step 4: 手工冒烟(记录，不阻断)**

启动 dev（`pnpm dev`），打开 `/admin/config` → OneBot tab：
- 「生效群」文本框存在，输入 `12345\n67890` 保存 → toast「配置已保存,Agent 已热重载」。
- 刷新页面，文本框回显 `12345` / `67890`（每行一个）。
- 留空保存 → 回显空。

- [ ] **Step 5: 提交**

```bash
git add app/admin/config/page.tsx
git commit -m "feat(admin): config 页加生效群编辑器"
```

---

### Task 8: 全量回归 + 收尾

**Files:** 无改动（验证任务）

- [ ] **Step 1: 全量测试**

Run: `pnpm vitest run`
Expected: 全绿。

- [ ] **Step 2: 构建**

Run: `pnpm build`
Expected: 成功。

- [ ] **Step 3: 更新 memory 进度（可选）**

若维护 `onebot-agent-progress.md`，追加一行：生效群白名单已实现（config+全链路门控+admin UI，测试绿）。

---

## Self-Review

**Spec coverage：**
- config 字段 `enabledGroups: number[]` + 默认 `[]` → Task 1 ✓
- gateway 门控 → Task 2 ✓
- message-buffer 门控 → Task 3 ✓
- reflection-poller 门控 → Task 4 ✓
- assemble/runtime 透传 → Task 5 ✓
- API schema → Task 6 ✓
- 管理 UI 编辑器 + 空名单提示 → Task 7 ✓
- adminGroup 豁免 → Task 2 用例覆盖 ✓
- 空名单=全关 → Task 1(默认[]) + 各门控 has() 逻辑 ✓
- 测试矩阵（config-store/gateway/buffer/poller/api）→ Task 1/2/3/4/6 ✓

**Placeholder scan：** 无 TBD/TODO；每个改代码步骤含完整代码块。UI textarea 用原生元素避免引入未确认的 shadcn 组件。

**Type consistency：** `enabledGroups: number[]` 全程一致；deps interface 均加同名字段；poller 中 deps 为可选 `enabledGroups?`（`resolve` 兜底 `[]`），与其它可选 deps 风格一致，`Resolved` 内为必填 `number[]`。`registerGateway`/`registerMessageBuffer` 的 deps 为必填（与既有必填字段一致）。

**Task 5 风险点已标注：** `tests/lib/runtime.test.ts` 若用假 cfg，需补 `enabledGroups: []`（Step 3 已提示）。
