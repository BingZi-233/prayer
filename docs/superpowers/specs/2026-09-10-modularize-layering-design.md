# 模块化分层重构设计

## 背景与承接

本文承接 [性能与可维护性第一阶段设计](2026-09-09-performance-maintainability-phase1-design.md)
（已合入 main）。那一阶段把「大页面拆分」列为非目标并推迟，本文接上它，同时处理
`lib/` 目录本身的归属混乱。

触发点不是「代码没有结构」。仓库已有分域（`agent/ db/ channels/ config/ tools/ plugins/`），
`docs/development.md` 也写了模块边界。真正的问题是**同一个概念散落在两个家**，以及
**多个目录的划分轴不一致**，导致为新功能选位置时每次都要人肉判断。

后续要铺的四条路：新消息通道、Agent 能力扩展、知识库与反思链路、后台运营与商业化。
本设计让这四类改动各自有唯一且可从目录名推断的落点。

## 目标

做完之后应满足三条可检验的判据：

1. `lib/` 根目录只剩 `runtime.ts`（组合根）一个文件。
2. 不打开代码，只看目录名就知道「新通道写哪、新 Agent 能力写哪、新知识库能力写哪」。
3. 分层测试以**空基线**运行（无白名单），逆向依赖由机器拦住而不是靠自觉。

## 当前证据

**通道侧不对称。** `lib/channels/tg/` 把单个通道的全部逻辑收在一处
（`client.ts` 572 行、`enrich.ts`、`media.ts`、`parse.ts`、`admins-cache.ts`、`bypass-state.ts`、
`trigger.ts`，共 7 个）。QQ 却被劈成两半：`client.ts` 在 `lib/channels/qq/`，而 `parse.ts`、
`enrich.ts`、`media.ts`、`admins.ts`、`members-fetch.ts` 留在 `lib/onebot/`，另外夹一个 5 行的
兼容 re-export `lib/onebot/client.ts`。`channels/qq/` 只有 2 个文件，`onebot/` 有 6 个。

**通道词汇不是传输层，而地基今天反向依赖它。** `lib/agent/*` 对 `lib/channels/*` 共 19 处
import，全部是类型或读配置的辅助函数：`ChannelId`、`ChatRef`、`makeSessionKey`、
`makeDedupeKey`、`parseSessionKey`、`legacySessionKeyToCanonical`，以及 `enabled-chats` 导出的
`getGroupPolicy`/`isAdminSurface`/`isChatEnabled`。没有一处触及传输实现。
`lib/events.ts` 也只以 `import type` 依赖 `channels/types`。

更能说明问题的是 `lib/config/`——这一层本应是地基——`chats.ts`、`env.ts`、`migrate.ts`、
`schema.ts` 共 4 处 import `../channels/types`，其中 `chats.ts` 与 `schema.ts` 是**运行时值**
import（`CHANNEL_IDS`），另两处是 `import type`。也就是说「配置」依赖「通道」，
「通道」的传输实现又反过来依赖「配置」，方向是乱的。

顺带记下一条：`lib/events.ts` 与 `lib/channels/types.ts` 以 `import type` 互相引用
（`events.ts:1` 取 `ChannelId`，`types.ts:1` 取 `ActionSend`）。类型层双向不构成运行时循环，
但说明这两者是同一个概念——收信与发信词汇——被拆在了两个目录。

**反思链路反向依赖 Agent 类。** `lib/agent/reflection-{poller,compactor,promoter}.ts` 从
`./agent` 取 `noToolQueryOptions` 与 `drainQuery`。也就是说「知识库与反思」这条链，
在结构上被迫依赖「会话与编排」。

**`lib/` 根目录散落 23 个裸文件**，其中成组的概念各飘一处：`reflect-promote.ts`（写入工具）
与 `lib/agent/reflection-promoter.ts`（编排）分居两地；`tool-stats.ts`、`usage-stats.ts`、
`reflect-stats.ts` 三个统计各占一处；`name-cache.ts`、`name-cache-store.ts`、`group-name.ts`
三个命名逻辑不成组。

**大文件。** `app/admin/sessions/page.tsx` 1077 行、`app/admin/kb/page.tsx` 1052 行、
`app/admin/reflection/page.tsx` 686 行、`app/admin/groups/page.tsx` 629 行、
`lib/agent/agent.ts` 715 行。

**已确认的重复与死代码。** `components/admin/nav-list-item.tsx` 全仓 0 引用（含动态字符串）。
渠道中文标签重复两份且已经跑偏：`sessions:76` 的 `CHANNEL_LABEL` 含 `discord → "Discord"`，
`groups:117` 的 `channelLabel` 没有该映射，非 qq/tg 直接返回原值。时长格式化至少 5 处
（`groups:93`、`proactive:66`、`reflection:101`、`handoff:40`、`sessions:141`），
其中 `proactive:66` 多出一个「秒」粒度层级，其余四处只有分钟粒度。

## 目标结构

```
lib/
  runtime.ts          # 唯一根文件 = 组合根，接通道 + agent + 后台循环
  core/               # L0 地基：不依赖任何其它层
    db/ config/
    bus.ts logger.ts log-context.ts app-context.ts config-store.ts
    auth.ts settings-writer.ts concurrency.ts utils.ts brand.ts api.ts
    chat/             # 收发信词汇与生效群状态
      types.ts events.ts ids.ts enabled-chats.ts name-cache.ts name-cache-store.ts group-name.ts
  model/              # L1 模型基座：SDK 调用与模型 I/O
    sdk-env.ts query-options.ts drain.ts system-prompt.ts tool-policy.ts prompt.ts
    sanitize-input.ts json-output.ts timeout.ts embed.ts
    stats/            # 模型与工具的用量计量
      usage.ts tool.ts
    plugins/
      manager.ts      # 本地 MCP server 进程管理 = 模型能用哪些工具
  channels/           # L2 通道实现
    qq/               # client.ts index.ts parse.ts enrich.ts media.ts admins.ts members-fetch.ts
    tg/               # client.ts parse.ts enrich.ts media.ts admins-cache.ts bypass-state.ts trigger.ts
    registry.ts factory.ts keepalive.ts
  knowledge/          # L2 知识库与反思
    kb.ts kb-path.ts kb-prefetch.ts
    reflection/
      poller.ts compactor.ts promoter.ts promote.ts stats.ts
  conversation/       # L3 会话与编排
    agent.ts orchestrator.ts session.ts gateway.ts message-buffer.ts reply-mapper.ts
    intent.ts answerability.ts handoff-handler.ts prior-context.ts error-handler.ts
    introspect.ts command-keywords.ts transcript.ts assemble.ts resolution-recorder.ts
    pollers/
      topic.ts unanswered.ts
```

四个非显然的判断，理由在此：

**一、`channels/{types,ids,enabled-chats}`、`events.ts` 与命名逻辑下沉到 `core/chat/`。**
它们是全仓共用词汇（见「当前证据」第一、二条）。留在 `channels/` 会让 `conversation/`
反向依赖传输层，把分层做成摆设。把 `events.ts` 一并迁入，是因为它与 `channels/types.ts`
本是一对（收信与发信词汇）却分居两处、以 `import type` 互引；并排放消除这个跨目录引用。
代价是 import 路径换名，不涉及逻辑。

**二、`lib/onebot/` 整个目录消失。** 五个模块并入 `channels/qq/`，与 `channels/tg/` 对称；
`client.ts` 那个兼容 shim 删掉。旧路径不保留。

**三、独立出 `model/` 层。** `agent.ts` 的 715 行里约 400 行回答的是「怎么调模型」
（SDK 环境、query options、drain、system prompt、工具白名单、prompt 构造），
不是「会话怎么走」。抽出来一举两得：既服务 `conversation/`，也让
`knowledge/reflection/*` 不再反向依赖 `agent.ts`。同属这一层的还有：
`sanitize-input`（打给模型的输入清洗）、`json-output`（模型结构化输出解析）、
`embed`（本地嵌入）、`usage-stats`/`tool-stats`（按调用点与工具名的用量计量，
`agent.ts` 与 `runtime.ts` 都消费）、`plugins/manager`（本地 MCP server 进程管理，
即模型能用哪些工具；消费者是 `app/api/plugins/*` 三个路由加三个测试文件）。

**四、`lib/tools/` 与 `lib/plugins/` 两个目录随之消失。** 前者的两个文件分别去 `model/`
与 `knowledge/`，后者唯一的 `manager.ts` 去 `model/plugins/`。不为单个文件保留一层。

## 依赖规则

单向偏序，只准从上往下依赖。下图箭头由依赖方指向被依赖方，`core` 在最底：

```
    runtime.ts
        ↓
   conversation
        ↓
  ┌─────┴─────┐
channels   knowledge
  └─────┬─────┘
        ↓
      model
        ↓
       core
```

- `core` 只依赖 `core`。
- `model` 只依赖 `core`。
- `channels`、`knowledge` 只依赖 `core` 与 `model`，两者是同级兄弟，互不依赖
  （已核实：零交叉 import）。
- `conversation` 可依赖以上全部。
- `runtime.ts` 是组合根，可依赖全部。`instrumentation.ts` 只调它。
- `app/` 可依赖全部。`components/` 只可依赖 `core` 与 `components/` 自身。现状核实：
  `components/` 对 `lib/` 的依赖只有 `utils`（41 处）、`brand`（3 处）、`config/schema`、
  `config/chats`、`channels/types` 各 1 处，搬迁后全部落在 `core` 内，无需破例。

**规则由测试执行，不靠自觉。** 新增 `tests/architecture/layering.test.ts`：扫描 `lib/**`
的每个文件，解析 import specifier，按映射表判定所在层，断言不存在逆向依赖，违规时报出
「文件 → 目标」。`app/` 无层约束（可依赖全部），无需扫描；受约束的是 `components/`，
由一条独立用例断言它只依赖 `core`。测试还需包含扫描器自检用例——用合成样例断言它确实
能识别逆向依赖，否则扫描器一旦失灵，护栏会静默空过。不引入新依赖，与仓库既有
`tests/ui/*-contracts.test.ts` 的结构契约测试风格一致。

**先清永久违规，再以空基线落地。** 按目标结构扫描全部 `lib/**` 的跨层依赖后，实际的
永久违规（即阶段全做完后依然存在）只有两条，其余都是阶段间的临时边。因为永久违规数量
少，**不采用白名单**——「登记违规 + 断言不新增」的结构会让护栏变成橡皮图章，往白名单加一
行的改动量与写业务代码同量级，评审里几乎不可见。改为：

1. 阶段 0 先修掉这两条永久违规（见下），使分层测试**以空基线落地**，无白名单可盖。
2. 阶段间的临时边用**边集合**表达，每条形如 `{ from, to, removedBy: "2b" }`，并额外断言
   「`removedBy` 等于当前阶段时该条目必须已不存在」，让临时条目到点自红。
3. 再断言边集合的**精确条数**。任何新增的跨层依赖都会改这个数字，暴露在 diff 里。

**两条永久违规：**

- `lib/onebot/members-fetch.ts:6` 向上依赖组合根 `lib/runtime.ts`（L88 用作默认 `fetchFn`）。
  修法：去掉 `getRuntime()` 默认值，把 `LoadGroupMembersOpts.fetchFn` 改为必填，由
  `app/api/onebot/admins/route.ts:49` 与 `app/api/onebot/members/route.ts:16` 两个调用点
  注入 runtime 的取成员能力。测试本来就传 `fetchFn`。
- `lib/db/repositories/knowledge.ts:3` 值导入 `../../tools/kb.ts` 的 `KB_SEARCH_SQL`
  （L123 用于 `.prepare()`）。阶段 2a 把 db 移入 core、阶段 4 把 kb 移入 knowledge 之后，
  这条变成 `core → knowledge` 逆向。修法：**SQL 归仓储所有**——把该常量定义挪进 knowledge
  仓储。注意 `lib/tools/kb.ts:19` 只定义、并不使用它，所有权本就错位。

两处修法都是行为不变：一处是把依赖反转成注入，一处是搬一个字符串常量。
`plugins/cs` 也按硬编码路径引 `KB_SEARCH_SQL`，必须与上一条同一阶段改（见「既有引用同步」）。

**初始边集合共 5 条**，除上面两条永久违规外，另有 3 条由阶段 3 消掉：

```
lib/agent/reflection-compactor.ts:6  knowledge → conversation  ./agent
lib/agent/reflection-poller.ts:7     knowledge → conversation  ./agent
lib/agent/reflection-promoter.ts:7   knowledge → conversation  ./agent
```

这三条正是「反思链路反向依赖 Agent 类」的实例化。阶段 3 把 `reflection-*` 的引用改指
`model/` 之后，`knowledge → model` 合法，边消失。它们的 `removedBy` 是 `"3"`。
**除此之外不应再有容忍条目**——容忍集合从阶段 0 的 3 条单调递减到阶段 4 的 0 条。

**映射表按文件的「目标层」判定，不按磁盘当前物理位置。** 这一点很关键：`channels/types.ts`
虽仍在 `lib/channels/` 下，映射表就把它当 `core`，因为它最终要去 `core/chat/`。于是
`lib/config/*` 对它的 4 处引用在任何阶段都不算逆向——即便阶段 2a 已把 `config/` 移入
`core/` 而 2b 还没搬 `types.ts`。中途的物理不一致不是违规，只有「最终归属」错位才是。
这样容忍集合里就不会出现随阶段生灭的噪声条目，它是一条单调递减的曲线。

同理，映射表按前缀匹配，搬迁完成时把旧前缀移入 `RETIRED` 列表，并断言**没有任何文件命中
已退役前缀**——这条断言免费换来「旧路径真的删干净了」的检查，比人肉 grep 可靠。

## 迁移阶段

每阶段一个独立分支，合入 main 后再开下一阶段，main 全程保持绿色。不建长命分支。

| 阶段 | 内容 | 性质 | 验收 |
| --- | --- | --- | --- |
| 0 清违规 + 护栏 | 修两条永久违规（`fetchFn` 改注入、`KB_SEARCH_SQL` 归仓储）；`layering.test.ts` 以空基线落地（边集合 + `removedBy` + 精确条数）；`docs/development.md` 补层规则；`CLAUDE.md` Git 约定增补 `refactor/*` 前缀 | 两处行为不变的依赖调整 + 只加测试 | `pnpm check` 绿 |
| 1 QQ 归并 | `lib/onebot/*` 并入 `channels/qq/`，删 shim；`tests/lib/onebot/*` 搬至 `tests/lib/channels/qq/` 并整目录删除 | 纯搬路径 | 6 个测试搬完仍绿；`lib/onebot/` 与 `tests/lib/onebot/` 均消失 |
| 2a core 地基 | `db/ config/` 与根目录设施迁入 `core/` | 纯搬路径 | 临时边条数只减不增 |
| 2b 共享词汇 | `channels/{types,ids,enabled-chats}`、`events.ts`、`name-cache*`、`group-name` 迁入 `core/chat/` | 纯搬路径 | `core/chat` 相关临时边清空 |
| 3 model 层 | 从 `agent.ts` 切出 `sdk-env`/`query-options`/`drain`/`system-prompt`/`tool-policy`/`prompt`；`sanitize-input`/`json-output`/`timeout` 迁入；`tools/embed` → `model/embed`；`usage-stats`/`tool-stats` → `model/stats/`；`plugins/manager` → `model/plugins/`；`reflection-*` 改指 `model/` | 切分 + 搬 | `agent.ts` 降至约 300 行，测试绿；`lib/tools/`、`lib/plugins/` 目录消失 |
| 4 知识/会话分层 | `tools/kb`、`kb-path`、`kb-prefetch`、`reflection-*`、`reflect-promote`、`reflect-stats` → `knowledge/`；其余 `agent/*` → `conversation/`（含 `resolution-recorder.ts`） | 纯搬路径 | **临时边集合清空** |
| 5 后台大文件 | 见下节 | 有设计 | 行为不变 + 真机验证；行数仅作手段 |
| 6 收尾文档 | 落位指南：新通道 / 新 Agent 能力 / 新知识库能力分别写哪 | 只加 | — |

阶段 1–4 是零行为改动（搬路径与切纯函数；阶段 3 只切不写）。阶段 0 的两处依赖调整
也是行为不变，它是本次唯一触碰函数签名与常量归属的地方，单独成一个分支便于评审。
阶段 5 与它们互相独立，顺序可调。

**每个搬迁阶段（1、2a、2b、3、4）的隐含必做项，同样进验收：** 同步
`tests/architecture/layering.test.ts` —— 改 `PREFIX_RULES` 里搬家文件的前缀、把旧前缀登记进
`RETIRED_PREFIXES`、按需下调 `TOLERATED` 并 bump `CURRENT_STAGE`。漏登记不会让核心的
「逆向依赖精确一致」失败，但会让「退役前缀已被清空」这条防线**静默失效**——那正是「旧路径
真的删干净了」的机器检查，靠人记得登记才生效。

代价如实说明：阶段 1–4 合计约 90 个源文件及对应测试需要改 import 路径。改动机械但量大，
所以拆成 7 个分支，使每刀评审只需看一个概念。

**分支与 CI 成本。** 分支前缀统一用 `refactor/*`，并在 `CLAUDE.md` 的 Git 约定里增补
该前缀——纯粹搬迁挂 `feat/` 语义不准。`.github/workflows/check.yml` 在 PR 与 push main
都触发，除 `pnpm check` 外还跑完整生产构建（约 20 分钟）。7 个阶段即 7 个 PR 加 7 次
main 构建。这个成本是拆细的代价，接受。

搬迁时**代码注释里的路径引用要一并改**，例如 `lib/db/migrations/schema.ts:34` 的注释提到
`lib/tool-stats.ts`。这类引用不进类型检查，漏了不会报错，只会慢慢腐烂。

### 既有引用同步（每阶段的必做项，不是收尾工作）

这是本设计最容易漏的一环，且漏了不会报错。要同步的有两类。

**一、文档。** 仓库有成文的结构约定文档，它们**现在就描述着即将不存在的路径**。
若把文档更新推到最后，阶段 2a 一合入，`docs/development.md` 的模块边界就开始说谎。

| 阶段 | 须同步的文档条目 |
| --- | --- |
| 0 | `docs/development.md` 增补分层规则；把阶段 1–4 将作废的条目**逐条列出并标注**「由阶段 N 改写」；`CLAUDE.md` 的 Git 约定增补 `refactor/*` 前缀 |
| 1 | `CLAUDE.md` 的「仓库结构」一节中的 `onebot/` 一项（该目录消失） |
| 2a | `docs/development.md` 的「模块边界」一节中 `lib/config/schema.ts`、`lib/config/{env,migrate,chats,patch}.ts`、`lib/config-store.ts`、`lib/db/repositories/`、`lib/db/migrations/` 五条路径；`docs/data-access.md` 里「以上路径相对于 `lib/db/`」与 `lib/db/index.ts` 的引用；`docs/database-operations.md` 里 `lib/db/migrations/registry.ts` 与 `lib/db/index.ts` 的引用；`CLAUDE.md` 的「仓库结构」一节中的 `db/` 项 |
| 2b | `docs/development.md` 的「模块边界」中 `lib/config-store.ts` 条目引用的 `lib/channels/enabled-chats.ts`（迁往 `lib/core/chat/`）。注意 `channels/types.ts`、`channels/ids.ts` 目前在文档中**没有任何引用**，2b 只需搬文件、无需改文档 |
| 3 | `CLAUDE.md` 的「仓库结构」一节中的 `tools/`、`plugins/` 两项（两个目录消失） |
| 4 | `CLAUDE.md` 的「仓库结构」一节中的 `agent/` 一项（拆为 `conversation/` 与 `knowledge/`）；`CLAUDE.md` 的「命令」一节举例的 `tests/lib/agent/session.test.ts`（该测试镜像 `lib/agent/session.ts`，随 `agent/` 一起迁） |

**不要在这些条目里写字面行号。** 行号会随任何一次编辑而腐烂，而腐烂的锚点会让施工者 grep 扑空、进而以为「已经改过了」。用章节名与文件名定位。

`docs/development.md` 的「模块边界」一节里有一句「`lib/config-store.ts` …… 只依赖存储的
两个键值操作」。该句在本设计取证时已被证伪（它运行时 import `channels/enabled-chats`），
要连同路径一起修正而不是照搬。阶段 0 已处理。

**二、代码里的硬路径，比文档危险。** 这些不是注释、不是类型导入，是**运行时才会解析的
字符串路径**，typecheck 与分层测试都抓不到，漏了就是线上故障：

| 位置 | 形式 | 何时失效 |
| --- | --- | --- |
| `instrumentation.ts:8-12,27` | 6 处相对路径 `await import("./lib/...")` | 阶段 2a、2b、3 各自涉及 |
| `scripts/ingest.ts:3-5` | `../lib/db/index.ts`、`../lib/db/repo.ts`、`../lib/tools/embed.ts` | 2a、3 |
| `scripts/db-maintenance.ts:4` | `../lib/db/backup.ts` | 2a |
| `proxy.ts:2` | `@/lib/auth` | 2a |
| `plugins/cs/scripts/cs-mcp.ts:55-59` | `pathToFileURL(join(root, "lib/tools/embed.ts"))` 与 `lib/tools/kb.ts` | **0（`KB_SEARCH_SQL` 改指向）、3、4** |

`plugins/cs` 这一条最险：它是**独立子进程**，按硬编码路径动态 import 主仓的模块
（`lib/tools/kb.ts:5` 的注释专门警告过该加载约束）。阶段 3 搬 `embed`、阶段 4 搬 `kb`
时必须同步改这两行，否则 cs 插件静默加载失败，而现有测试多半不覆盖这条路径。

**另注命名易混**：仓库顶层有 `plugins/`（`cs`、`packyapi` 两个本地 MCP server），
本设计又新增 `model/plugins/`。两者含义不同（前者是插件本体，后者管理插件进程），
但名字相近容易误读，实施时需在 `model/plugins/manager.ts` 的文档注释里点明区别。

## 阶段 5：后台大文件拆分

沿用 `components/admin/config/` 已确立的模式——**区块组件与状态 hook 同目录**（那里已有
`use-config-form.ts`，`components/admin/use-polling.ts` 亦然，`hooks/` 现仅 `use-mobile.ts`）。
这是追认现状，不是新约定。`hooks/` 根目录只留给真正跨页面的 hook。

下面每页给的拆分后行数是**目标而非验收门槛**（理由见「验收标准」第 5 条），
用来判断职责是否还混在一起。

按省力到难排序，每页一个分支：

**1. `reflection/page.tsx` 686 → 约 200。** 最省力。`CompactionRow`（L117–216）与
`EntryRow`（L246–387）已自包含、自带详情懒加载，外提几乎零摩擦。产出
`components/admin/reflection/{compaction-row,entry-row,entry-list}.tsx` 与
`use-reflection-actions.ts`。

**2. `groups/page.tsx` 629 → 约 200。** 产出 `groups/{group-table,policy-sheet}.tsx` 与
`policy-payload.ts`（L50–135 的纯函数约 85 行）。摩擦点：Sheet 三个 Tri 状态经 `openEditor`
读取 `globals` 默认值，外提时须把 `globals` 一并传入，或收成 `use-group-policy-form`。

**3. `sessions/page.tsx` 1077 → 约 200。** 产出
`sessions/{channel-badge,session-list,transcript-view,session-dialogs}.tsx` 与
`use-session-selection.ts`（约 200 行）。最硬的摩擦点：六个 ref（`activeKeyRef`、
`sessionsRef`、`transcriptGenRef`、`mountedRef`、`writingUrlKeyRef`、`lastHandledUrlKeyRef`）
跨 `openSession` ↔ effect ↔ poller 共享，且 URL 同步（L230–302）与三个 effect
（L356–402）、`refresh`（L404–421）是一体的竞态治理。**必须整体进同一个 hook，拆两半即坏。**

**4. `kb/page.tsx` 1052 → 约 150。** 产出
`kb/{tree.ts,markdown-body.tsx,file-tree.tsx,editor-panel.tsx,file-dialogs.tsx}` 与
`use-kb-files.ts`（约 250 行）。摩擦点：L236–250 与 L289–306 两处「渲染期调整 state」的写法
是刻意绕 lint 的，外提时必须原样搬，不得顺手改成 effect；⌘/Ctrl+S 的 effect（L264–274）
带 `eslint-disable` 且依赖 `content`，连同注释一起搬。

**顺带清理**（同阶段做，不单开分支）：

- 删 `components/admin/nav-list-item.tsx`（全仓 0 引用）。
- 频道中文标签合并为 `core/chat/` 中一处。注意不是简单复制：`sessions:76` 的版本含
  `discord` 映射，`groups:117` 的没有，合并时取全集。
- 时长格式化合并为一处。现有至少 5 处（`groups:93`、`proactive:66`、`reflection:101`、
  `handoff:40`、`sessions:141`），其中只有 `proactive:66` 支持「秒」粒度，
  合并后要保留该粒度能力，否则是行为退化。

## 非目标

本次不做：

- 不改任何运行时行为，不改数据库 schema。`db/migrations/` 的 SQL 与迁移语义一字不动，
  只随目录搬迁更新其中的路径注释。
- 不重命名 `app/api/*` 路由。`/api/onebot/*` 这类是传输名而非域名，理想应域名化，
  但那要同步修改后台的 fetch 调用点，另行开事项。
- 不动 `components/ui/`（shadcn 生成物）。
- 不引入新依赖。依赖方向由自写的结构契约测试守卫，不引 `dependency-cruiser`。
- 不写双路径兼容 shim，旧路径直接删除（已确认可删 `lib/onebot/client.ts` 之类的 re-export）。
- 不改**提示词文案与模型参数取值**。阶段 3 会把 `system-prompt`、`tool-policy`、`prompt`
  从 `agent.ts` 切出去，但只搬移，一字不改内容——这三块正落在 phase 1 冻结的
  「提示词、模型参数」区（见 phase 1 非目标第 5 条），动了就是翻案。
- 不处理认证模型与 Cloud 多租户架构（沿用 phase 1 的推迟决定）。
- 不删不建 `lib/channels/discord/`。它目前只是 README 占位（`factory.ts:62` 注明二期），
  随 `channels/` 保留原位。
- **不改错误事件的 `scope` 标签。** `lib/channels/qq/client.ts` 里有一处
  `scope: "onebot.enrich"`，它会经 `lib/logger.ts` 格式化成 `[onebot.enrich]` 出现在日志里，
  属**可观察输出**，改名就是行为变更。按通道前缀命名它该是 `qq.enrich`（TG 侧对应值是
  `tg.enrich`），但那是独立的行为变更，不属于任何一次「纯搬迁」，另行处理。

## 验收标准

1. 每个阶段结束时 `pnpm check`（typecheck + lint + 完整 Vitest）通过。
2. `layering.test.ts` 从阶段 0 起就是空基线（无白名单）；阶段 4 结束时其临时边集合
   亦清空，只剩精确条数 0。
3. `lib/` 根目录只剩 `runtime.ts`。
4. 阶段 5 每页行为不变——按 `docs/development.md` 的「环境与验证」一节的浏览器验证配方真机检查：
   临时数据库、独立 Claude 配置目录、清空 QQ/TG 连接参数、关闭知识库预热与主动回复。
   后四项是防止开发检查触发真实客服应答的，不可省略。
5. **页面行数是手段，不是指标。** `docs/development.md` 明写「优先保护用户可感知行为，
   而非组件数量、函数调用细节或文件行数」。行数只用于判断「是否仍有职责混杂」，
   不作验收门槛，验收看行为不变与契约测试。
6. 涉及页面与打包边界时另跑生产构建：本机有实例在跑时用
   `NEXT_DIST_DIR=.next-verify pnpm build`，避免覆盖正在服务的 `.next`
   （见 `docs/development.md` 的「环境与验证」一节）。
7. 不把 `data/`、凭证或运行时产物纳入提交。

## 风险

**临时边集合仍可被加行。** 空基线消除了「永久例外」这个口子，但阶段间的临时边本身就是
一份可编辑清单。缓解靠三点：`removedBy` 到点自红、精确条数断言、以及这些条目只在
阶段 1–4 生存。阶段 4 结束后**该集合必须为空**，否则本次整理视为未完成。

**阶段 0、3、5 不是纯移动**（阶段 0 动函数签名与常量归属，阶段 3 真实切分，阶段 5 有设计），
且三者都触及实际代码路径。靠既有测试套件兜底；三者都不触碰数据库 schema 与运行时行为，
`git revert` 即可回滚，不需要数据层回滚。阶段 1、2a、2b、4 是纯文件移动，回滚即 revert
该分支，无残留。

**阶段 1 不是逐字搬测试。** `tests/lib/onebot/` 的 6 个测试文件要与源码一起搬到
`tests/lib/channels/qq/`（现该目录只有 `channel.test.ts`，与 tg/ 才有同名冲突不同，无重名）。
但 `tests/lib/onebot/client.test.ts:6` 导入的正是要删除的 shim，必须改指
`@/lib/channels/qq/client`（`OneBotClient` 的实际定义处）——这是改写 import，不是搬文件。
搬空后 `tests/lib/onebot/` 整目录删除。

**分层测试只守跨层方向，层内方向无人管。** 现存两处层内互引：
`lib/config-store.ts` 运行时 import `channels/enabled-chats`，而后者以 `import type` 反向
引用 `config-store`——**编译期擦除，不构成运行时循环**；`lib/events.ts` 与
`lib/channels/types.ts` 同样以 `import type` 互引。搬迁后它们同属 `core`，按层规则合法，
测试不会报。本次不动——调整任意一处都会改变配置读取的初始化顺序，属行为改动。
登记为已知债务、另开事项。这也说明 `layering.test.ts` 不能当唯一防线。
