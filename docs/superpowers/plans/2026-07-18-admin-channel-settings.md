# 管理后台全面多通道设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理后台与 channel 模型对齐——配置页按通道分栏、管理面可选 QQ/TG、生效会话统一表并用 `policyKey` 写策略。

**Architecture:** 后端 `adminSurface: ChatRef` 与 gateway/handoff 已跨通道；本次以 UI + 策略写路径修复为主，并补 TG 管理面回归测试。配置 API 契约不变。

**Tech Stack:** Next.js 16 App Router、React client components、shadcn/ui、vitest、现有 `/api/config` 与 `/api/groups/activity`。Prettier：无分号、双引号。测试在 `tests/`。

参考 spec：`docs/superpowers/specs/2026-07-18-admin-channel-settings-design.md`

**分支：** `feat/admin-channel-settings`（从最新 main 开，勿直接提交 main）

**验收总命令：** `pnpm typecheck && pnpm lint && pnpm test`

---

## 文件结构

### 修改

| 文件 | 职责 |
|------|------|
| `tests/lib/agent/gateway.test.ts` | 补 TG 管理面 `!reset` / `!resume` |
| `tests/lib/agent/handoff-handler.test.ts` | 补 TG 管理面抄送（任意通道来源） |
| `app/admin/groups/page.tsx` | 跨通道表、toggle/策略用 chat-ref + policyKey、文案 |
| `app/admin/config/page.tsx` | Tab 重组、管理面独立 Tab + 选择器、文案 |
| `components/app-sidebar.tsx` | 「生效群」→「生效会话」 |
| `app/admin/layout.tsx` | 「OneBot 客服 Agent」→「客服 Agent」 |

### 可选（仅当 config 页难读时）

| 文件 | 职责 |
|------|------|
| `app/admin/config/helpers.ts` | `Cfg` 类型、`withQqChats` / `withTgChats` / `qqChatIds` / `tgChatIds` |

### 不改（除非测试红）

- `lib/agent/gateway.ts`、`lib/agent/handoff-handler.ts`（预期已正确）
- `app/api/config/route.ts`、`app/api/groups/activity/route.ts`
- `lib/config-store.ts`、`lib/channels/enabled-chats.ts`

---

### Task 1: 分支 + TG 管理面 gateway 测试

**Files:**
- Modify: `tests/lib/agent/gateway.test.ts`
- Branch: `feat/admin-channel-settings`

- [ ] **Step 1: 建分支**

```bash
cd /Users/ziyou/projects/prayer
git checkout main
git pull --ff-only 2>/dev/null || true
git checkout -b feat/admin-channel-settings
```

- [ ] **Step 2: 在 gateway 测试文件末尾（最后一个 `it` 之后、文件 `describe` 闭合前）追加两个用例**

在 `tests/lib/agent/gateway.test.ts` 中，参考现有「管理群 !reset」写法，追加：

```ts
  it("TG 管理面 !reset <key> → 清 resumeId 并回 TG", async () => {
    bus.removeAllListeners()
    registerGateway({
      repo,
      botQQ: 555,
      adminSurface: { channel: "tg" as const, chatId: "-100999" },
      enabledChats: [{ channel: "qq" as const, chatId: "1" }],
      supportUrl: "https://example.com",
    })
    const sk = "qq:1:2"
    repo.setSessionId(sk, "sid-tg-admin")
    const p = new Promise<any>((res) => bus.once("action.send", res))
    bus.emit("message.received", {
      channel: "tg" as const,
      chatId: "-100999",
      userId: "7",
      messageId: "tg-reset-1",
      rawText: `!reset ${sk}`,
      atList: [],
    })
    const a = await p
    expect(a.channel).toBe("tg")
    expect(a.chatId).toBe("-100999")
    expect(a.text).toContain(sk)
    expect(repo.getResumeId(sk)).toBeUndefined()
  })

  it("TG 管理面 !resume <key> → handoff.resumed", async () => {
    bus.removeAllListeners()
    registerGateway({
      repo,
      botQQ: 555,
      adminSurface: { channel: "tg" as const, chatId: "-100999" },
      enabledChats: [{ channel: "qq" as const, chatId: "1" }],
      supportUrl: "https://example.com",
    })
    const sk = "qq:1:2"
    const p = new Promise<any>((res) => bus.once("handoff.resumed", res))
    bus.emit("message.received", {
      channel: "tg" as const,
      chatId: "-100999",
      userId: "7",
      messageId: "tg-resume-1",
      rawText: `!resume ${sk}`,
      atList: [],
    })
    const h = await p
    expect(h.sessionKey).toBe(sk)
    expect(h.by).toBe("admin")
  })
```

- [ ] **Step 3: 跑测试**

```bash
pnpm vitest run tests/lib/agent/gateway.test.ts
```

Expected: 全部 PASS（若 FAIL，先读 `lib/agent/gateway.ts` 管理面分支再最小修，再重跑）

- [ ] **Step 4: Commit**

```bash
git add tests/lib/agent/gateway.test.ts
git commit -m "$(cat <<'EOF'
test(gateway): 覆盖 TG 管理面 !reset / !resume

EOF
)"
```

---

### Task 2: TG 管理面 handoff 抄送测试

**Files:**
- Modify: `tests/lib/agent/handoff-handler.test.ts`

- [ ] **Step 1: 在文件末尾 `describe` 闭合前追加用例**

```ts
  it("adminSurface 为 TG 时 QQ 用户 handoff → 通知发 TG", async () => {
    bus.removeAllListeners()
    repo = new Repo(openDb(":memory:"))
    registerHandoffHandler({
      repo,
      adminSurface: { channel: "tg" as const, chatId: "-100999" },
      handoffTimeoutMin: 30,
      scanMs: 60_000,
    })
    const sends: any[] = []
    bus.on("action.send", (a) => sends.push(a))
    bus.emit("handoff.requested", {
      channel: "qq" as const,
      sessionKey: SK,
      chatId: "1",
      userId: "2",
      lastQuestion: "退款",
      reason: "user",
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(repo.isHumanMode(SK)).toBe(true)
    expect(
      sends.some(
        (s) =>
          s.channel === "qq" && s.chatId === "1" && s.text.includes("转接")
      )
    ).toBe(true)
    expect(
      sends.some(
        (s) =>
          s.channel === "tg" &&
          s.chatId === "-100999" &&
          s.text.includes("转人工") &&
          s.text.includes(SK)
      )
    ).toBe(true)
    // 不应再抄送到旧 QQ 管理面
    expect(
      sends.filter((s) => s.channel === "qq" && s.chatId === "999").length
    ).toBe(0)
  })

  it("adminSurface 为 TG 时 TG 用户 handoff → 用户回 TG，通知也发 TG 管理面", async () => {
    bus.removeAllListeners()
    repo = new Repo(openDb(":memory:"))
    registerHandoffHandler({
      repo,
      adminSurface: { channel: "tg" as const, chatId: "-100999" },
      handoffTimeoutMin: 30,
      scanMs: 60_000,
    })
    const sends: any[] = []
    bus.on("action.send", (a) => sends.push(a))
    bus.emit("handoff.requested", {
      channel: "tg" as const,
      sessionKey: "tg:-1001:42",
      chatId: "-1001",
      userId: "42",
      lastQuestion: "怎么退款",
      reason: "user",
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(
      sends.some(
        (s) =>
          s.channel === "tg" &&
          s.chatId === "-1001" &&
          s.text.includes("转接")
      )
    ).toBe(true)
    expect(
      sends.some(
        (s) =>
          s.channel === "tg" &&
          s.chatId === "-100999" &&
          s.text.includes("转人工")
      )
    ).toBe(true)
  })
```

注意：原用例「TG 用户 handoff → 通知发 adminSurface(QQ)」**保留**（QQ 管理面回归）。

- [ ] **Step 2: 跑测试**

```bash
pnpm vitest run tests/lib/agent/handoff-handler.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/lib/agent/handoff-handler.test.ts
git commit -m "$(cat <<'EOF'
test(handoff): 覆盖 TG 管理面跨通道抄送

EOF
)"
```

---

### Task 3: 生效会话页 — 类型与写路径（policyKey + 跨通道 toggle）

**Files:**
- Modify: `app/admin/groups/page.tsx`

- [ ] **Step 1: 更新 Row 类型与 busy 主键**

将：

```ts
interface Row {
  groupId: number;
  enabled: boolean;
  // ...
}
```

改为（保留 `groupId` 兼容字段）：

```ts
type ChannelId = "qq" | "tg" | "discord";

interface Row {
  channel: ChannelId;
  chatId: string;
  /** 兼容旧字段；勿作主键 */
  groupId: number;
  enabled: boolean;
  messageCount: number;
  lastTs: number;
  cursor: number;
  sedimentedCount: number;
  policy: GroupPolicy;
  hasOverride: boolean;
  policyKey: string;
  effective: {
    proactiveEnabled: boolean;
    proactiveSilenceMs: number;
    notifyAdminOnHandoff: boolean;
  };
}
```

状态：

```ts
const [busyKey, setBusyKey] = useState<string | null>(null);
// 删除 busyId: number | null
```

显示名辅助（文件内局部即可）：

```ts
function rowLabel(r: Pick<Row, "channel" | "chatId" | "groupId">, nameFn: (id: number) => string): string {
  if (r.channel === "qq" && r.groupId > 0) return nameFn(r.groupId);
  if (r.channel === "tg" && r.groupId !== 0) {
    const n = nameFn(r.groupId);
    if (n && n !== String(r.groupId)) return n;
  }
  return r.chatId;
}

function channelLabel(c: ChannelId): string {
  if (c === "qq") return "QQ";
  if (c === "tg") return "TG";
  return c;
}
```

- [ ] **Step 2: 重写 `toggle` / `savePolicy` / `clearPolicy`**

```ts
async function toggle(row: Row, enable: boolean) {
  setBusyKey(row.policyKey);
  try {
    const cur = await fetch("/api/config").then((x) => x.json());
    if (!cur.ok) {
      toast.error(cur.error || "读取配置失败");
      return;
    }
    type ChatRef = { channel: string; chatId: string };
    const chats: ChatRef[] = Array.isArray(cur.data.enabledChats)
      ? [...cur.data.enabledChats]
      : [];
    const others = chats.filter(
      (c) => !(c.channel === row.channel && c.chatId === row.chatId)
    );
    const next: ChatRef[] = enable
      ? [...others, { channel: row.channel, chatId: row.chatId }]
      : others;
    const r = await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabledChats: next }),
    }).then((x) => x.json());
    if (r.ok) {
      const label = `${channelLabel(row.channel)} · ${rowLabel(row, name)}`;
      toast.success(enable ? `已生效: ${label}` : `已关闭: ${label}`);
      if (enable) {
        toast.message("用法提示", {
          description: "群内问 bot 请 @机器人;重置发「重置」;转人工发「人工」。",
        });
      }
      await refresh();
    } else {
      toast.error(r.error || "保存失败");
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  } finally {
    setBusyKey(null);
  }
}

async function savePolicy() {
  if (!editing) return;
  setSavingPolicy(true);
  try {
    const policy: GroupPolicy = {};
    const pe = triToBool(proactiveTri);
    if (pe !== undefined) policy.proactiveEnabled = pe;
    if (silenceMode === "custom") {
      const m = Number(silenceMin);
      if (!Number.isFinite(m) || m < 0) {
        toast.error("静默阈值须为非负数字(分钟)");
        return;
      }
      policy.proactiveSilenceMs = Math.round(m * 60_000);
    }
    const nh = triToBool(handoffTri);
    if (nh !== undefined) policy.notifyAdminOnHandoff = nh;

    const key = editing.policyKey;
    const payload =
      Object.keys(policy).length === 0
        ? { groupPolicies: { [key]: null } }
        : { groupPolicies: { [key]: policy } };

    const r = await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then((x) => x.json());
    if (r.ok) {
      toast.success(`已保存 ${channelLabel(editing.channel)} · ${rowLabel(editing, name)} 的策略`);
      setEditing(null);
      await refresh();
    } else {
      toast.error(r.error || "保存失败");
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  } finally {
    setSavingPolicy(false);
  }
}

async function clearPolicy(row: Row) {
  setBusyKey(row.policyKey);
  try {
    const r = await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupPolicies: { [row.policyKey]: null } }),
    }).then((x) => x.json());
    if (r.ok) {
      toast.success(`已恢复跟随全局: ${channelLabel(row.channel)} · ${rowLabel(row, name)}`);
      if (editing?.policyKey === row.policyKey) setEditing(null);
      await refresh();
    } else toast.error(r.error || "清除失败");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  } finally {
    setBusyKey(null);
  }
}
```

- [ ] **Step 3: 更新 JSX 表头/行/Sheet**

关键替换点：

1. `PageHeader` title=`生效会话`；description 用「按会话开关…」
2. SectionCard title=`会话活动与策略`；emptyTitle/emptyDescription 改为会话语义
3. 表头第一列改为「会话」；在名称前加通道 Badge
4. `TableRow key={r.policyKey}`（禁止 `key={r.groupId}`）
5. Switch：`disabled={busyKey === r.policyKey}`，`onCheckedChange={(v) => toggle(r, v)}`
6. clearPolicy：`onClick={() => clearPolicy(r)}`
7. SheetTitle：`会话策略 · {editing ? `${channelLabel(editing.channel)} · ${rowLabel(editing, name)}` : ""}`
8. SheetDescription 副标题可加 mono：`editing?.policyKey`
9. 文案「转人工通知」保留；全局说明里「管理群」若有则改「管理面」
10. MetricBadge「独立策略」value 用 `` `${overrideCount} 会话` ``

会话单元格示例：

```tsx
<TableCell className="font-medium">
  <div className="flex flex-col gap-0.5">
    <div className="flex items-center gap-1.5">
      <Badge variant="outline" className="text-[10px] px-1.5">
        {channelLabel(r.channel)}
      </Badge>
      <span>{rowLabel(r, name)}</span>
    </div>
    <span className="text-muted-foreground font-mono text-xs">{r.chatId}</span>
  </div>
</TableCell>
```

- [ ] **Step 4: typecheck 该文件无 TS 错误**

```bash
pnpm typecheck
```

Expected: 无与 groups page 相关的错误

- [ ] **Step 5: Commit**

```bash
git add app/admin/groups/page.tsx
git commit -m "$(cat <<'EOF'
fix(admin): 生效会话页跨通道 toggle 与 policyKey

EOF
)"
```

---

### Task 4: 配置页 — 管理面 Tab 与选择器

**Files:**
- Modify: `app/admin/config/page.tsx`

- [ ] **Step 1: 删除 QQ-only 管理面辅助，改为通用**

保留 `adminQqId` 可继续用于 QQ 分支，新增：

```ts
function setAdminSurface(
  cfg: Cfg,
  channel: "qq" | "tg" | null,
  chatId: string
): Cfg {
  if (!channel || !chatId.trim()) {
    return { ...cfg, adminSurface: null };
  }
  return {
    ...cfg,
    adminSurface: { channel, chatId: chatId.trim() },
  };
}
```

删除或停用仅写 QQ 的 `setAdminQq`；保存前校验：

```ts
// 在 save() 开头，setBusy(true) 之前
if (cfg.adminSurface) {
  const id = cfg.adminSurface.chatId?.trim();
  if (!id) {
    toast.error("管理面已选通道但未填会话");
    return;
  }
}
if (
  cfg.adminSurface?.channel === "tg" &&
  !(cfg.telegramBotToken && !cfg.telegramBotToken.includes("•")) &&
  !String(cfg.telegramBotToken || "").trim()
) {
  // 掩码表示已有 token，无需警告；仅完全空字符串时警告
}
// 更稳妥：
const tgTokenLooksEmpty =
  !cfg.telegramBotToken || cfg.telegramBotToken.trim() === "";
if (cfg.adminSurface?.channel === "tg" && tgTokenLooksEmpty) {
  toast.message("提示", {
    description: "TG 管理面已选，但 Bot Token 为空，通知可能发不出。",
  });
}
```

（掩码 `•` 表示已有 token，**不要**当空。）

- [ ] **Step 2: 重组 TabsList**

将：

```tsx
<TabsTrigger value="onebot">… OneBot</TabsTrigger>
<TabsTrigger value="telegram">… Telegram</TabsTrigger>
```

改为（图标可继续用 `Cable` / `Send` / `Bell` 或 `Shield`）：

```tsx
<TabsTrigger value="qq"><Cable data-icon="inline-start" /> QQ 通道</TabsTrigger>
<TabsTrigger value="tg"><Send data-icon="inline-start" /> TG 通道</TabsTrigger>
<TabsTrigger value="admin"><Bell data-icon="inline-start" /> 管理面</TabsTrigger>
```

对应 `TabsContent`：

- `value="onebot"` → `value="qq"`（内容：连接 + 生效群 + extraAt；**移出** adminSurface 与 handoffTimeoutMin）
- `value="telegram"` → `value="tg"`（内容不变）
- **新建** `value="admin"`：

```tsx
<TabsContent value="admin">
  <SectionCard
    title="管理面"
    description="转人工/反思/用量告警抄送与 !reset / !resume 落点。可与生效白名单无关。"
  >
    <FieldGroup>
      <Field>
        <FieldLabel>通道</FieldLabel>
        <Select
          value={
            cfg.adminSurface?.channel === "qq"
              ? "qq"
              : cfg.adminSurface?.channel === "tg"
                ? "tg"
                : "none"
          }
          onValueChange={(v) => {
            if (v === "none") {
              setCfg({ ...cfg, adminSurface: null });
              return;
            }
            if (v === "qq") {
              const prev =
                cfg.adminSurface?.channel === "qq"
                  ? cfg.adminSurface.chatId
                  : "";
              setCfg({
                ...cfg,
                adminSurface: prev
                  ? { channel: "qq", chatId: prev }
                  : { channel: "qq", chatId: "" },
              });
              return;
            }
            if (v === "tg") {
              const prev =
                cfg.adminSurface?.channel === "tg"
                  ? cfg.adminSurface.chatId
                  : enabledTgIds[0] ?? "";
              setCfg({
                ...cfg,
                adminSurface: { channel: "tg", chatId: prev },
              });
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="选择管理面通道" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">无（关闭）</SelectItem>
            <SelectItem value="qq">QQ</SelectItem>
            <SelectItem value="tg">Telegram</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {cfg.adminSurface?.channel === "qq" && (
        <Field>
          <FieldLabel>QQ 管理群</FieldLabel>
          {groups ? (
            <Select
              value={cfg.adminSurface.chatId || ""}
              onValueChange={(v) =>
                setCfg({
                  ...cfg,
                  adminSurface: { channel: "qq", chatId: v },
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择管理群" />
              </SelectTrigger>
              <SelectContent>
                {adminGroupOptions().map((g) => (
                  <SelectItem key={g.groupId} value={String(g.groupId)}>
                    {g.groupName} ({g.groupId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <FieldDescription>
              {groupsLoading ? "正在获取群列表…" : "bot 未连接,无法获取群列表。"}
            </FieldDescription>
          )}
        </Field>
      )}

      {cfg.adminSurface?.channel === "tg" && (
        <Field>
          <FieldLabel>TG 管理 Chat</FieldLabel>
          {enabledTgIds.length > 0 ? (
            <Select
              value={
                enabledTgIds.includes(cfg.adminSurface.chatId)
                  ? cfg.adminSurface.chatId
                  : "__custom__"
              }
              onValueChange={(v) => {
                if (v === "__custom__") return;
                setCfg({
                  ...cfg,
                  adminSurface: { channel: "tg", chatId: v },
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="从生效 Chat 选择" />
              </SelectTrigger>
              <SelectContent>
                {enabledTgIds.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
                <SelectItem value="__custom__">手填下方 ID…</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
          <Input
            className="mt-2 font-mono text-xs"
            value={cfg.adminSurface.chatId}
            placeholder="如 -1001234567890"
            onChange={(e) =>
              setCfg({
                ...cfg,
                adminSurface: { channel: "tg", chatId: e.target.value },
              })
            }
          />
          <FieldDescription>
            字符串原样保存（可负号）。管理面不必在生效白名单内。
          </FieldDescription>
        </Field>
      )}

      <Field>
        <FieldLabel htmlFor="handoffTimeoutMin">转人工超时(分钟)</FieldLabel>
        <Input
          id="handoffTimeoutMin"
          inputMode="numeric"
          value={num("handoffTimeoutMin")}
          onChange={(e) => upd("handoffTimeoutMin", e.target.value)}
        />
        <FieldDescription>
          转人工后无人处理超过此时长自动恢复自动答。默认 30 分钟。
        </FieldDescription>
      </Field>
    </FieldGroup>
  </SectionCard>
</TabsContent>
```

- [ ] **Step 3: 从 QQ Tab 移除管理群号与 handoffTimeout；更新文案**

- QQ 生效群 `FieldDescription`：`也可在「生效会话」页一键开关。`
- 去掉「一期仅 QQ 管理面」类文案
- PageHeader description：`修改后保存即生效。通道连接与业务参数分栏。`
- 通知 Tab：`反思通知管理群` → `反思通知管理面`；Section description `向管理面推送的运行通知。`
- 回复体验里若有「管理群告警」→「管理面告警」

- [ ] **Step 4: 修正 `adminGroupOptions`**

当 `adminSurface.channel === "qq"` 时，若当前 `chatId` 不在 groups 列表，注入占位项（与现逻辑类似，用 `cfg.adminSurface.chatId` 而非仅 `adminQq`）。

- [ ] **Step 5: typecheck**

```bash
pnpm typecheck
```

Expected: PASS（或仅无 config 相关错误）

- [ ] **Step 6: Commit**

```bash
git add app/admin/config/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin): 配置页通道分栏与跨通道管理面

EOF
)"
```

---

### Task 5: 侧栏与顶栏文案

**Files:**
- Modify: `components/app-sidebar.tsx`
- Modify: `app/admin/layout.tsx`

- [ ] **Step 1: 侧栏**

`components/app-sidebar.tsx` 中：

```ts
{ href: "/admin/groups", label: "生效会话", icon: Users },
```

（href 保持 `/admin/groups`）

- [ ] **Step 2: 顶栏**

`app/admin/layout.tsx`：

```tsx
<span className="min-w-0 truncate text-sm font-medium">客服 Agent</span>
```

- [ ] **Step 3: Commit**

```bash
git add components/app-sidebar.tsx app/admin/layout.tsx
git commit -m "$(cat <<'EOF'
fix(admin): 侧栏生效会话与顶栏去 OneBot 叙事

EOF
)"
```

---

### Task 6: 全量验收

**Files:** 无新文件（修红测若有）

- [ ] **Step 1: 跑全量检查**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全部通过

- [ ] **Step 2: 若有失败**

- 仅改相关文件最小修复
- 再跑失败用例直至绿
- 单独 commit：`fix: …`

- [ ] **Step 3: 对照 spec 手工清单（开发机有 bot 时）**

1. 配置 QQ / TG 通道保存
2. 管理面切 QQ / TG 各保存一次
3. 生效会话页开关 TG 行、写策略、清覆盖
4. 刷新后配置与策略仍在

- [ ] **Step 4: 最终状态**

```bash
git log --oneline main..HEAD
git status
```

Expected: 工作区干净；commits 对应 Task 1–5（+ 可选 fix）

---

## Spec 覆盖自检

| Spec 要求 | Task |
|-----------|------|
| TG 管理面命令测试 | Task 1 |
| 跨通道 handoff 抄送测试 | Task 2 |
| 生效会话统一表 + policyKey | Task 3 |
| 配置页 Tab + 管理面选择器 | Task 4 |
| 侧栏/顶栏文案 | Task 5 |
| typecheck/lint/test | Task 6 |
| Discord 不做 | 全任务无 Discord UI |
| 不改 config API 契约 | 无 Task 改 route |

## 占位符自检

计划内无 TBD/TODO；步骤含可粘贴代码与命令。
