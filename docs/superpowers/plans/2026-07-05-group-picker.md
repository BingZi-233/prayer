# 群多选下拉（带群名）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** config 页管理群号改 shadcn Select 单选、生效群改可搜多选下拉，均按 NapCat `get_group_list` 群名展示；bot 未连接则禁用+提示。

**Architecture:** `config 页` → `GET /api/onebot/groups` → `getRuntime().getGroups()` → `OneBotClient.getGroupList()` → WS `call("get_group_list")`（echo 关联，8s 超时降级 undefined → API 503 → UI 禁用）。

**Tech Stack:** TypeScript, Next.js App Router, ws, vitest, shadcn/ui (select/command/popover/checkbox)。

**测试运行前缀：** `pnpm vitest run <path>`；构建 `pnpm build`；类型 `npx tsc --noEmit`。

---

### Task 1: OneBotClient.getGroupList

**Files:**
- Modify: `lib/onebot/client.ts`
- Test: `tests/lib/onebot/client.test.ts`

- [ ] **Step 1: 写失败测试**

追加到 `tests/lib/onebot/client.test.ts` 的 `describe("OneBotClient", …)` 块内。对端收到含 `echo` 的请求后回 `{echo, data:[...]}`：

```ts
it("getGroupList → 发 get_group_list 并按 echo 解析 data", async () => {
  const port = await startServer((ws) => {
    ws.on("message", (raw: Buffer) => {
      const req = JSON.parse(raw.toString());
      if (req.action === "get_group_list") {
        ws.send(JSON.stringify({
          echo: req.echo,
          data: [{ group_id: 111, group_name: "群甲" }, { group_id: 222, group_name: "群乙" }],
        }));
      }
    });
  });
  client = new OneBotClient(`ws://127.0.0.1:${port}`);
  client.start();
  await new Promise((r) => setTimeout(r, 100)); // 等连接 open
  const list = await client.getGroupList();
  expect(Array.isArray(list)).toBe(true);
  expect((list as any[]).map((g) => g.group_id)).toEqual([111, 222]);
});

it("getGroupList 未连接 → undefined", async () => {
  client = new OneBotClient("ws://127.0.0.1:1"); // 不连
  const list = await client.getGroupList();
  expect(list).toBeUndefined();
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run tests/lib/onebot/client.test.ts`
Expected: FAIL（`client.getGroupList` 不是函数）。

- [ ] **Step 3: 实现**

`lib/onebot/client.ts`：在 `private call(...)` 方法之上（`sendAction` 之后）加公开方法：

```ts
  // 拉群列表(get_group_list)。未连接/超时 → undefined(不抛)。
  getGroupList(): Promise<unknown[] | undefined> {
    return this.call("get_group_list", {}).then((data) =>
      Array.isArray(data) ? data : undefined
    );
  }
```

（`call` 已存在：echo 关联，未连接直接 resolve undefined，超时 resolve undefined。）

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run tests/lib/onebot/client.test.ts`
Expected: PASS（含既有用例）。

- [ ] **Step 5: 提交**

```bash
git add lib/onebot/client.ts tests/lib/onebot/client.test.ts
git commit -m "feat(onebot): OneBotClient.getGroupList 拉群列表"
```

---

### Task 2: RuntimeClient 接口 + RuntimeManager.getGroups

**Files:**
- Modify: `lib/runtime.ts`
- Test: `tests/lib/runtime.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/lib/runtime.test.ts` 的 `describe("RuntimeManager", …)` 块内追加：

```ts
it("getGroups 委托 client.getGroupList", async () => {
  const b = fakeBuilders({
    makeClient: () => ({
      start() {}, stop() {}, isConnected: () => true,
      getGroupList: async () => [{ group_id: 111, group_name: "群甲" }],
    }) as never,
  });
  m.start(cfg, b);
  const list = await m.getGroups();
  expect(list).toEqual([{ group_id: 111, group_name: "群甲" }]);
});

it("未 start → getGroups 返回 undefined", async () => {
  expect(await m.getGroups()).toBeUndefined();
});

it("client 无 getGroupList → getGroups 返回 undefined", async () => {
  m.start(cfg, fakeBuilders()); // fakeBuilders 的 client 无 getGroupList
  expect(await m.getGroups()).toBeUndefined();
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run tests/lib/runtime.test.ts`
Expected: FAIL（`m.getGroups` 不是函数）。

- [ ] **Step 3: 实现**

`lib/runtime.ts`：`RuntimeClient` 接口加可选方法：

```ts
interface RuntimeClient {
  start(): void;
  stop(): void;
  isConnected(): boolean;
  getGroupList?(): Promise<unknown[] | undefined>;
}
```

`RuntimeManager` 类内（`getStatus()` 之后）加方法：

```ts
  async getGroups(): Promise<unknown[] | undefined> {
    return this.client?.getGroupList?.();
  }
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run tests/lib/runtime.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/runtime.ts tests/lib/runtime.test.ts
git commit -m "feat(runtime): RuntimeManager.getGroups 委托 client"
```

---

### Task 3: API 路由 GET /api/onebot/groups

**Files:**
- Create: `app/api/onebot/groups/route.ts`
- Test: 无 route-handler 测试基建（仓库既有惯例，见 tests/lib/api.test.ts 仅测纯函数）；靠 `npx tsc --noEmit` + Task 6 build 验证

- [ ] **Step 1: 实现**

新建 `app/api/onebot/groups/route.ts`：

```ts
import { NextResponse } from "next/server";
import { getRuntime } from "@/lib/runtime";
import { ok, fail } from "@/lib/api";

export async function GET(): Promise<NextResponse> {
  const raw = await getRuntime().getGroups();
  if (!Array.isArray(raw)) {
    return NextResponse.json(fail("bot 未连接或无法获取群列表"), { status: 503 });
  }
  const list = raw
    .map((g) => {
      const o = g as { group_id?: unknown; group_name?: unknown };
      const groupId = Number(o.group_id);
      return { groupId, groupName: String(o.group_name ?? groupId) };
    })
    .filter((g) => Number.isFinite(g.groupId) && g.groupId > 0);
  return NextResponse.json(ok(list));
}
```

- [ ] **Step 2: 类型验证**

Run: `npx tsc --noEmit`
Expected: No errors。

- [ ] **Step 3: 提交**

```bash
git add app/api/onebot/groups/route.ts
git commit -m "feat(api): GET /api/onebot/groups 归一化群列表"
```

---

### Task 4: 安装 shadcn 组件

**Files:**
- Create: `components/ui/select.tsx`, `components/ui/command.tsx`, `components/ui/popover.tsx`, `components/ui/checkbox.tsx`（由 CLI 生成）
- Modify: `package.json` / `pnpm-lock.yaml`（新 radix/cmdk 依赖）

- [ ] **Step 1: 安装**

Run: `pnpm dlx shadcn@latest add select command popover checkbox`
（若交互提示 overwrite，选否/保留已有；badge 已存在勿覆盖。若 CLI 需要确认，用非交互 flag：`pnpm dlx shadcn@latest add select command popover checkbox -y`。）

- [ ] **Step 2: 确认生成与依赖**

Run: `ls components/ui/ | grep -E "select|command|popover|checkbox"`
Expected: 四个文件都在。

Run: `grep -E "@radix-ui/react-select|@radix-ui/react-popover|@radix-ui/react-checkbox|cmdk" package.json`
Expected: 相应依赖已加入。

- [ ] **Step 3: 类型/构建验证**

Run: `npx tsc --noEmit`
Expected: No errors（新组件自洽）。

- [ ] **Step 4: 提交**

```bash
git add components/ui/select.tsx components/ui/command.tsx components/ui/popover.tsx components/ui/checkbox.tsx package.json pnpm-lock.yaml
git commit -m "chore(ui): 安装 shadcn select/command/popover/checkbox"
```

---

### Task 5: config 页改群下拉

**Files:**
- Modify: `app/admin/config/page.tsx`
- Test: 无自动化 UI 测试；靠 `pnpm build` + 手工冒烟

**说明：** 移除 Task 7 遗留的 `groupsText`/`commitGroups`/Textarea（生效群手填）与 `adminGroupId` 的 `<Input>`。新增群列表拉取 + 两个下拉。以下给出完整替换代码。

- [ ] **Step 1: import 与状态**

文件顶部 import 区加（放在现有 ui import 之后）：

```ts
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ChevronsUpDown } from "lucide-react";
```

组件内，`const [busy, setBusy] = useState(false);` 之后加：

```ts
  const [groups, setGroups] = useState<{ groupId: number; groupName: string }[] | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(true);
```

移除 Task 7 的 `const [groupsText, setGroupsText] = useState("")`（及其所有引用 `setGroupsText`）。

- [ ] **Step 2: 拉群列表**

在现有 `useEffect(() => { fetch("/api/config")... }, [])` 之后加第二个 effect：

```ts
  useEffect(() => {
    fetch("/api/onebot/groups")
      .then((x) => x.json())
      .then((r) => setGroups(r.ok ? r.data : null))
      .catch(() => setGroups(null))
      .finally(() => setGroupsLoading(false));
  }, []);
```

在现有 fetch("/api/config") 的 `.then` 里移除对 `setGroupsText` 的调用（若 Task 7 加过）。`save()` 里同样移除 `setGroupsText`。

- [ ] **Step 3: toggle helper**

在组件内 `const num = (k: keyof Cfg) => ...;` 之后加：

```ts
  // 生效群多选 toggle:维护 cfg.enabledGroups(number[])
  function toggleGroup(id: number) {
    if (!cfg) return;
    const set = new Set(cfg.enabledGroups);
    set.has(id) ? set.delete(id) : set.add(id);
    setCfg({ ...cfg, enabledGroups: Array.from(set) });
  }
  // 群名查找:不在列表(bot 已退群)→ 裸 id
  const groupName = (id: number) => groups?.find((g) => g.groupId === id)?.groupName ?? String(id);
```

- [ ] **Step 4: 替换「管理群号」Field**

OneBot tab 里把现有 `adminGroupId` 的 `<Field>...</Field>`（含 `<Input id="adminGroupId" .../>`）整体替换为：

```tsx
                  <Field>
                    <FieldLabel htmlFor="adminGroupId">管理群号</FieldLabel>
                    {groups ? (
                      <Select value={cfg.adminGroupId ? String(cfg.adminGroupId) : ""} onValueChange={(v) => upd("adminGroupId", v)}>
                        <SelectTrigger id="adminGroupId">
                          <SelectValue placeholder="选择管理群" />
                        </SelectTrigger>
                        <SelectContent>
                          {groups.map((g) => (
                            <SelectItem key={g.groupId} value={String(g.groupId)}>
                              {g.groupName} ({g.groupId})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <FieldDescription>
                        {groupsLoading ? "正在获取群列表…" : "bot 未连接,无法获取群列表。请先填写连接并启动 bot。"}
                      </FieldDescription>
                    )}
                  </Field>
```

（`upd` 已把 `adminGroupId` 归入 `NUM_KEYS` → 自动 `Number(v)`。）

- [ ] **Step 5: 替换「生效群」Field**

把 Task 7 的生效群 `<Field>`（含 `<Textarea id="enabledGroups" .../>`）整体替换为多选下拉：

```tsx
                  <Field>
                    <FieldLabel>生效群</FieldLabel>
                    {groups ? (
                      <>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" role="combobox" className="justify-between font-normal">
                              {cfg.enabledGroups.length ? `已选 ${cfg.enabledGroups.length} 个群` : "选择生效群"}
                              <ChevronsUpDown className="opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="p-0" align="start">
                            <Command>
                              <CommandInput placeholder="搜索群名…" />
                              <CommandList>
                                <CommandEmpty>无匹配群</CommandEmpty>
                                <CommandGroup>
                                  {groups.map((g) => (
                                    <CommandItem key={g.groupId} value={g.groupName + g.groupId} onSelect={() => toggleGroup(g.groupId)}>
                                      <Checkbox checked={cfg.enabledGroups.includes(g.groupId)} className="mr-2" />
                                      {g.groupName} ({g.groupId})
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                        {cfg.enabledGroups.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {cfg.enabledGroups.map((id) => (
                              <Badge key={id} variant="secondary" className="cursor-pointer" onClick={() => toggleGroup(id)}>
                                {groupName(id)} ✕
                              </Badge>
                            ))}
                          </div>
                        )}
                        <FieldDescription>
                          仅这些群里 bot 才会回复 / 缓冲 / 沉淀知识。留空 = 对所有群都不响应。管理群不受此列表影响。
                        </FieldDescription>
                      </>
                    ) : (
                      <FieldDescription>
                        {groupsLoading ? "正在获取群列表…" : "bot 未连接,无法获取群列表。请先填写连接并启动 bot。"}
                      </FieldDescription>
                    )}
                  </Field>
```

- [ ] **Step 6: 编译验证**

Run: `npx tsc --noEmit && pnpm build`
Expected: tsc 无错；build 成功。

- [ ] **Step 7: 手工冒烟（记录，不阻断）**

`pnpm dev` → `/admin/config` OneBot tab：
- bot 未连时：两字段显示「bot 未连接…」提示，无下拉。
- bot 连上后刷新：管理群 Select 列群名可选；生效群点开可搜、勾选、Badge 展示、点 Badge 取消；保存 toast「配置已保存,Agent 已热重载」；刷新回显已选。

- [ ] **Step 8: 提交**

```bash
git add app/admin/config/page.tsx
git commit -m "feat(admin): 管理群/生效群改群名下拉选择"
```

---

### Task 6: 全量回归 + 收尾

**Files:** 无改动（验证任务）

- [ ] **Step 1: 全量测试**

Run: `pnpm vitest run`
Expected: 全绿。

- [ ] **Step 2: 类型 + 构建**

Run: `npx tsc --noEmit && pnpm build`
Expected: 均成功。

- [ ] **Step 3: 更新 memory 进度（可选）**

`onebot-agent-progress.md` 生效群段追加：群号改带群名下拉（get_group_list + /api/onebot/groups + shadcn select/command/popover/checkbox）。

---

## Self-Review

**Spec coverage：**
- OneBotClient.getGroupList → Task 1 ✓
- RuntimeClient 接口 + RuntimeManager.getGroups → Task 2 ✓
- GET /api/onebot/groups 归一化 + 503 → Task 3 ✓
- shadcn select/command/popover/checkbox 安装 → Task 4 ✓
- 管理群 Select 单选 + 生效群多选下拉 + 未连接禁用提示 + 裸 id 回退 + Badge 取消 → Task 5 ✓
- cfg 语义不变（adminGroupId:number / enabledGroups:number[]）→ Task 5 用 upd/toggleGroup 维护 ✓
- 测试矩阵（client.getGroupList / runtime.getGroups）→ Task 1/2 ✓
- 全量回归 → Task 6 ✓

**Placeholder scan：** 无 TBD/TODO；每个改代码步骤含完整代码块。

**Type consistency：**
- `getGroupList(): Promise<unknown[] | undefined>` 在 client（Task 1）、RuntimeClient 接口（Task 2）一致。
- `getGroups(): Promise<unknown[] | undefined>`（Task 2）→ API 层 `Array.isArray` 收窄（Task 3）。
- 归一化形状 `{groupId:number, groupName:string}` 在 API（Task 3）与前端 `groups` state（Task 5）一致。
- `upd("adminGroupId", v)`：v 为 string，`NUM_KEYS` 含 adminGroupId → 转 number，与 `Cfg.adminGroupId:number` 一致。

**风险点：**
- Task 4 shadcn CLI 可能交互/联网；若失败，实现者应报 BLOCKED（可改手动创建组件文件，但优先 CLI）。
- Task 5 依赖 Task 4 的组件文件与 Task 3 的路由存在；顺序执行。
- `NUM_KEYS` 若未含 `adminGroupId` 需确认（现有代码 `NUM_KEYS = ["botQQ","adminGroupId","handoffTimeoutMin"]` 已含）。
