# 数据库迁移与备份

项目使用 SQLite `user_version` 管理结构版本。当前版本与迁移顺序集中在
`lib/core/db/migrations/registry.ts`，应用启动只通过 `lib/core/db/index.ts` 打开数据库。

## 迁移结构

- `runner.ts` 校验版本顺序，并让每一步迁移内容与 `user_version` 在同一事务提交。
- `registry.ts` 是唯一的版本注册表，记录版本号、中文名称、首次升级和幂等修复入口。
- `schema.ts` 保留 v1/v2 历史表转换及各版本实际 SQL，避免启动入口了解迁移细节。
- 数据库版本高于当前程序支持版本时，程序拒绝启动，防止旧程序误写新结构。
- 不支持自动降级。回滚程序版本前，应同时恢复该版本生成的数据库备份。

新增迁移时，只在注册表末尾追加连续版本。迁移必须是同步数据库操作，不得包含
网络请求、文件写入或其他 SQLite 事务无法回滚的副作用。`up` 用于首次升级；只有
可以安全重复执行的结构补齐才放入 `repair`。

## 发布前备份

检查当前数据库：

```bash
pnpm db:check
```

创建在线一致性备份：

```bash
pnpm db:backup
```

两个命令默认读取 `DB_PATH`，未配置时使用 `./data/agent.db`。也可以显式传入路径：

```bash
pnpm db:backup ./data/agent.db ./backups/agent-before-release.db
```

数据库路径应使用普通文件路径，或不带 query/fragment 的本机绝对 `file:` URI；带 SQLite
URI 选项、远程主机或相对路径的 `file:` URI 会被拒绝。这样不会把 `mode=ro` 等访问语义
意外降级为可写的普通文件打开。

`DB_PATH` 属于部署级存储边界，不应通过管理 API 在线切换；需要迁移时先停掉应用和后台任务，完成备份与恢复校验，再在部署环境更新变量并启动新进程。

备份使用 SQLite 在线备份 API，能够包含 WAL 中已提交的数据。创建前检查源数据库，
先在目标目录的私有随机临时目录生成并重新以只读方式打开备份执行
`PRAGMA integrity_check`，再以不可覆盖的原子发布方式落到目标路径。目标文件必须不存在，
防止误覆盖最后一份可用备份，也避免目标路径在检查与写入之间被替换成符号链接。

## 数据保留与 transcript 清理

`pnpm db:retention` 是只读预检，输出各表的过期候选行数和受保护的会话数；它不会
自动删除数据，也不会执行 `VACUUM`。建议先生成一份新备份，再在停机窗口确认报告后
显式传入 `--apply`：

```bash
pnpm db:backup ./data/agent.db ./backups/before-retention.db
pnpm db:retention ./data/agent.db
pnpm db:retention ./data/agent.db --apply
```

默认策略是：`reflect_compactions` 180 天，主题出现记录/孤立主题和非活动会话 365
天，模型/工具日用量 730 天，已成功投递的 `outbox_messages` 记录 90 天（`pending`、
`sending`、`failed` 会保留以便重试和排障）。会话只有在非人工、无 `resume_id` 且没有任何历史工单时才会
清理；有工单（包括已关闭）、人工接管或续接指针的旧会话会在报告中标为 protected。现有反思
轮询器继续负责 `resolution_events`、主动回复和入站去重表的 90/90/7 天窗口。

Claude transcript 位于 `CLAUDE_CONFIG_DIR/projects`，默认不会被扫描。需要评估时显式
指定目录（按文件 mtime 统计，默认 90 天）：

```bash
pnpm db:retention ./data/agent.db \
  --transcripts=./data/claude-config/projects
```

数据库清理和 transcript 删除是两个独立动作；只有同时传入
`--apply --transcripts=/absolute/path --delete-transcripts` 才会删除根目录下过期的
`.jsonl` 普通文件（递归子目录）。脚本拒绝跟随符号链接，删除前会重新检查 mtime；若只是想清理数据
库，不要传 `--delete-transcripts`。当前仓库没有自动 cron，部署方应把备份、报告、人工
确认和 apply 编排成可审计的作业，并保留每次命令输出。

## 恢复流程

1. 停止 PM2 进程，确认没有应用或脚本持有数据库连接。
2. 对备份执行 `pnpm db:check <备份路径>`。
3. 保留当前数据库文件及同名的 `-wal`、`-shm` 文件，作为回退副本。
4. 将已验证的备份复制为配置中的 `DB_PATH`，不要带入旧数据库的 `-wal`、`-shm`。
5. 启动应用，检查启动日志、管理后台状态和关键数据。

恢复刻意不做成运行中的 HTTP 接口。替换 SQLite 主文件要求所有连接停止，交给部署
流程执行可以避免在线覆盖、旧 WAL 重放和多进程同时恢复。

## 验证要求

数据库改动至少覆盖以下测试：

- 从受影响的最早版本逐级升级到最新版；
- 同一版本重复打开，结构和数据保持不变；
- 中途失败时，当前步骤的结构、数据和版本号全部回滚；
- 修复失败原因后能从最后成功版本继续；
- 更高版本数据库被旧程序拒绝。

提交前运行 `pnpm check`，并使用隔离数据库执行生产构建。
