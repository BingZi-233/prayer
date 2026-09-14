# Prayer 项目完善程度评估

> 评估日期：2026-09-13
> 评估提交：`d5304c2`（`main`）
> 评估方式：源码与依赖静态检查、CodeGraph、自动化测试、生产构建、SQLite/PM2/日志只读检查、运行中管理 API 冒烟、文件权限和依赖审计。

## 结论

Prayer 已经超过“能运行的 Demo”阶段，是一个核心闭环较完整的单实例 AI 客服系统：QQ/OneBot、Telegram、知识库、插件/MCP、转人工、反思沉淀和管理后台都已连成工作流。

但它还不能被称为“无条件生产就绪”。综合工程与功能完善度约 **6.8/10（可概括为 7/10）**；功能闭环约 **8/10**，商业生产保障约 **5.5–6/10**。

- 受控内测、小规模单实例生产：有条件可用。
- 公开互联网、高 SLA、多管理员或不受信任插件环境：当前不建议放行。

> 评分是风险和完成度的工程判断，不是测试覆盖率，也不代表任何安全认证。

## 已验证的基线

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| 工作树 | 通过 | `main` 干净，HEAD 为 `d5304c2` |
| 类型、Lint、回归测试 | 通过 | `pnpm check`：103 个测试文件、1,019 个测试全部通过 |
| 生产构建 | 通过 | Next.js 16.3.4/Turbopack，TypeScript 通过，40 个静态页面生成 |
| 数据库完整性 | 通过 | `pnpm db:check` 通过，当前 schema 为 v9 |
| 知识库结构审计 | 通过 | 48 个 retrieval 文件、216 个单元、最大 475 字、token 超限 0 |
| 知识库检索冒烟 | 通过 | 5 组固定查询命中合理，`dynamicReflectionHits=0` |
| 运行中服务 | 当前在线 | PM2 单 fork 进程在线；本次状态检查时 QQ/TG 已连接 |
| 管理面冒烟 | 通过 | 本次列出的管理页与只读 API 均返回 HTTP 200 |

## 分维度评估

### 1. 产品功能闭环：8/10

优势：

- QQ（OneBot/NapCat）与 Telegram 共用会话、知识、编排和运营能力。
- 支持知识库预检索、业务插件/MCP、转人工、人工恢复、主动补位和反思升格。
- 管理后台覆盖状态、会话、人工接管、知识库、反思、排行、用量、日志、插件和通道配置。
- 出站消息已经有持久化 outbox、租约、重试和分块投递记录；语义是本地**至少一次**，不是平台级 exactly-once。

边界：Discord 目前只有预留类型，没有生产适配器；价格、状态、公告等动态事实依赖外部插件，不能由静态知识库保证实时性。项目自身也把知识库审核、人工接管演练、通道权限、备份恢复、鉴权和预算列为上线前事项，见 [README 当前边界](/Users/ziyou/projects/prayer/README.md:326)。

### 2. 架构与可维护性：8.5/10

代码分层清楚：`runtime` 负责组合生命周期，`conversation` 编排会话，`channels` 与 `knowledge` 是并列能力层，`model` 和 `core` 提供下层基础。迁移按版本顺序在事务中执行，高版本数据库会拒绝启动，数据库访问也已拆成仓储边界。

主要扣分项：

- `startAll()` 使用 `Promise.allSettled()`，单通道失败后仍可能把全局状态标记为 `running`，见 [registry.ts](/Users/ziyou/projects/prayer/lib/channels/registry.ts:88) 和 [runtime.ts](/Users/ziyou/projects/prayer/lib/runtime.ts:254)。
- `reconfigure()` 是“停止后重新启动”，没有互斥、失败回滚或操作审计，项目文档也明确列为未完成项，见 [development.md](/Users/ziyou/projects/prayer/docs/development.md:91)。
- 分层测试是静态 import 扫描；测试文件自身说明，漏登记的旧路径在父规则仍存活时可能被静默放过，见 [layering.test.ts](/Users/ziyou/projects/prayer/tests/architecture/layering.test.ts:72)。

### 3. 测试与验证能力：6.5/10

`pnpm check` 和 `pnpm build` 很稳定，数据库迁移、核心编排、outbox、知识分块等有较多单元测试。

但当前仍缺少：

- Playwright 或其他真实浏览器 E2E；`tests/ui` 主要读取源码并断言视觉/结构契约。
- 覆盖率报告和最低覆盖率门槛。
- 多通道断线重连、进程重启、数据库恢复、长时间运行、磁盘增长和负载测试。
- 对知识库的 golden set 召回率、误命中率和 URL 新鲜度测试。

因此，“1,019 个测试通过”证明回归基线良好，但不能证明完整的用户路径和灾难恢复能力。

### 4. 运行可靠性与可观测性：6/10

本次运行快照显示服务在线、通道连接正常、outbox 当前记录均为 `sent`，这是积极信号。但历史 PM2 日志（覆盖 2026-07-06 至 2026-09-13）中仍有：

- 4,267 行错误日志；
- 620 次 Telegram `getUpdates 409` 冲突，说明可能存在多实例/重复轮询或所有权问题；
- 652 次富化错误、286 次 topic 错误、161 次反思压缩错误；
- 还出现网络 502、deadline 和模型调用超时。

当前看板的 `error` 指标口径不完整：[/api/overview](/Users/ziyou/projects/prayer/app/api/overview/route.ts:12) 只统计 `resolution_events`，而许多 `error.occurred` 事件只被 [error-handler](/Users/ziyou/projects/prayer/lib/conversation/error-handler.ts:85) 记录到日志，没有进入 resolution 统计。因此“看板 error=0”不能解释为“系统没有错误”。

另外，应用代码没有独立的外部 liveness/readiness、指标导出、告警或优雅排空钩子，当前状态主要依赖 PM2 和受保护的管理 API。

### 5. 知识库与数据质量：6.5/10

知识库内容治理已经有不错的基础：

- 当前 retrieval 树 48 个文件、216 个单元，最大 475 字；
- 使用 BGE-small-zh-v1.5，预期 512 维，token 审计没有超限；
- 条目包含来源、核验日期和动态性边界；
- 结构审计和固定查询冒烟脚本明确声明只读，不会替代生产入库。

仍存在两个重要缺口：

1. 磁盘内容与生产向量索引不完全一致：磁盘预期普通文档分块 220 个，数据库实际 218 个；已确认两个 promoted 文档的分块数不匹配。
2. 当前没有自动 freshness gate、语义 golden set 或来源 URL 失效检查。`pnpm ingest` 会递归扫描 `docs/kb` 下的 `.md`/`.txt`，见 [scripts/ingest.ts](/Users/ziyou/projects/prayer/scripts/ingest.ts:29)；未来若归档目录出现可见扩展名文件，可能被误纳入。

本次没有执行生产入库；应在明确授权后做一次受控重建并核对文件哈希、分块数、向量维度和数据库版本。

### 6. 安全：5.5/10

已有的安全基础：生产环境缺少 `ADMIN_TOKEN` 时会 fail-closed；鉴权比较采用恒时算法；登录有进程内失败限速；KB 路径拒绝绝对路径和 `..`；SQL 使用参数化查询。

当前主机快照发现的风险：

- `.env`、`data/claude-config/settings.json`、数据库及 WAL 都是 `644`；认证缓存文件是 `666`。这些文件包含管理口令、模型凭据或会话数据。
- 登录 Cookie 设置了 `httpOnly` 和 `sameSite`，但没有显式 `secure`；没有明确的 Origin/CSRF 防护。
- `clientIp()` 直接信任首个 `X-Forwarded-For`，只适合可信反向代理配置。
- Next 应用本身未设置 CSP、HSTS、X-Frame-Options 等安全响应头，当前依赖反代补齐。
- 所有 `mcp__*` 工具被无条件放行，和可安装第三方插件的能力组合后，不符合长期最小权限原则，见 [tool-policy.ts](/Users/ziyou/projects/prayer/lib/model/tool-policy.ts:48)。
- KB 写入请求没有内容大小上限，路径检查没有 `realpath`/symlink 防护。
- 富化失败日志会保留原始图片 URL，transcript 页面可读取包含工具输入和结果的会话内容。
- `pnpm audit --prod` 发现一个 moderate `adm-zip` 漏洞，经 `onnxruntime-node` 间接引入，修复版本为 `0.6.1+`。

### 7. 运维、发布与数据生命周期：5/10

有 CI、PM2 单实例配置、数据库完整性检查和在线备份脚本；数据库迁移文档也写明了恢复步骤，见 [database-operations.md](/Users/ziyou/projects/prayer/docs/database-operations.md:18)。

但当前没有形成完整的生产运营闭环：

- 未发现自动数据库备份排程、异地备份、保留策略或真实恢复演练记录。
- PM2 配置中的 10 MB 日志轮转依赖 `pm2-logrotate` 模块；当前 PM2 模块目录为空，轮转未被环境证明。
- `reflect_compactions` 约 119 MiB，是数据库最大的表；没有对应的清理策略。
- Claude transcript 目录约 1.4 GB、约 56,737 个文件，没有应用级保留/归档策略。
- 仓库没有 `LICENSE`、`SECURITY.md`、`CHANGELOG` 或版本标签，发布和责任边界不完整。

## 发布阻塞项与建议顺序

### P0：对外开放前必须完成

1. 将 `.env`、模型配置、数据库、WAL 和备份权限收紧到进程用户可读，并轮换现有凭据。
2. 增加独立 liveness/readiness；必要通道启动失败时返回 degraded/not ready，而不是 `running`。
3. 将通道错误、反思失败、outbox pending/failed、磁盘增长和预算消耗纳入统一指标与告警；修正 overview 的错误统计口径。
4. 把主动回复扫描/静默间隔限制在保守范围，后台明确显示“持久化配置覆盖环境默认值”。
5. 在获得授权后重建 KB 索引，并建立磁盘—数据库 freshness 校验。

### P1：下一迭代完成

- 为 transcript、反思压缩、topics、occurrences、usage 和 sessions 建立保留、归档和清理任务。
- 建立自动备份、异地保存、恢复演练和部署回滚流程。
- 为重配置增加互斥、失败回滚和操作审计。
- 增加真实浏览器 E2E、关键 API 集成测试、覆盖率门槛、断线重连和长时间运行测试。
- 将 MCP 改为按 server/tool 的显式 capability allowlist，并记录插件安装、启用和升级审计。
- 补齐 secure Cookie、CSRF、响应头、请求体上限、symlink 防护、RBAC 和日志脱敏。
- 升级或隔离 `adm-zip` 依赖。

### P2：发布完善

- 补充 LICENSE、SECURITY、CHANGELOG、版本标签和正式部署模板。
- 用目录级规则保证 `_archive` 永不进入生产入库。
- 增加负载、容量和磁盘增长基准。
- 若产品路线需要，再实现 Discord 适配器。

## 放行标准

满足以下条件后，才建议把项目标记为正式生产版本：

- [ ] 凭据和运行数据权限符合最小权限，已完成轮换验证。
- [ ] liveness/readiness、告警和错误指标能发现通道冲突与后台任务失败。
- [ ] 主动回复配置经过限流和人工演练，未出现刷屏/重复发送。
- [ ] 数据库备份可在隔离环境恢复，且有保留和回滚记录。
- [ ] KB 文件、分块、向量维度和索引版本一致。
- [ ] transcript、日志和反思数据有保留、归档、脱敏策略。
- [ ] 登录、关键管理操作和主要用户路径有浏览器级回归覆盖。
- [ ] 依赖审计无未处理的生产阻断项，发布文档和责任边界齐全。

## 评估边界

本报告没有做外部渗透测试、真实灾难恢复演练、并发压测、多主机部署测试或第三方服务长期稳定性验证；这些项目不能从当前源码和一次运行快照中推断出来。

除构建产生的已忽略产物外，本次没有修改源代码、数据库、知识库或项目运行配置；没有执行生产入库、数据库备份或写入型管理操作。
