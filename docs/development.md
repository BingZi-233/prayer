# 开发与代码质量

## 环境与验证

Node 版本见 `.node-version`，pnpm 版本见 `package.json` 的 `packageManager`。
使用 `pnpm install --frozen-lockfile` 安装，保证本地与 CI 采用相同依赖。

提交前运行 `pnpm check`，执行 TypeScript、ESLint 和完整 Vitest 测试。
涉及页面、路由或打包边界时，还应运行生产构建；本机已有服务时使用
`NEXT_DIST_DIR=.next-verify pnpm build`，避免覆盖正在服务的 `.next`。
GitHub Actions 会在 PR 和 main 推送时执行检查与构建。

浏览器验证使用临时数据库、独立 Claude 配置目录，清空 QQ/TG 连接参数并关闭
知识库预热与主动回复，避免开发检查触发真实客服应答。配置页至少检查：修改、
切换标签后保留草稿、保存、刷新回读、请求失败后重试。

## 分层结构

`lib/` 按能力分五层，单向依赖，只准从上往下：

```
    runtime.ts          # 组合根,接通道 + agent + 后台循环
        ↓
   conversation         # 会话与编排
        ↓
  ┌─────┴─────┐
channels   knowledge    # 通道实现 / 知识库与反思(同级,互不依赖)
  └─────┬─────┘
        ↓
      model             # SDK 调用与模型 I/O
        ↓
       core             # 地基:db、config、日志、总线、通道词汇
```

- 新增消息通道写 `lib/channels/<通道>/`；新增 Agent 能力写 `lib/conversation/`；
  新增知识库能力写 `lib/knowledge/`。
- 后台运营与商业化页面写 `app/admin/`；鉴权、品牌、存储等横切能力进 `core/`。
- `app/` 可依赖全部；`components/` 只可依赖 `core` 与 `components/` 自身。
- 规则由 `tests/architecture/layering.test.ts` 执行，不靠自觉。跨层依赖会直接让测试失败。

### 搬迁中：待改写条目

`lib/` 正分阶段搬到上述结构。以下条目描述的路径在搬迁完成后不再存在，
**由对应阶段负责改写，不是遗留说明**：

| 条目 | 作废阶段 |
| --- | --- |
| `CLAUDE.md` 的「仓库结构」一节里的 `onebot/` 项 | 1 |
| 「模块边界」中 `lib/config-store.ts` 条目引用的 `lib/channels/enabled-chats.ts`（迁往 `lib/core/chat/`） | 2b |
| `CLAUDE.md` 的「仓库结构」一节里的 `tools/`、`plugins/` 项 | 3 |
| `CLAUDE.md` 的「仓库结构」一节里的 `agent/` 项（拆为 `conversation/` 与 `knowledge/`），与「命令」一节举例的 `tests/lib/agent/session.test.ts` 路径 | 4 |

## 模块边界

- `app/` 负责页面编排和 HTTP 输入输出。路由文件只导出框架支持的处理函数与配置，
  不把校验规则导出给业务模块或测试使用。
- `components/admin/config/` 按功能维护配置区块；`use-config-form.ts` 持有唯一草稿，
  管理数据请求与保存。区块组件不自行持久化，切换标签不会丢失修改。
- `lib/core/config/schema.ts` 定义完整配置、默认值和类型，`AppConfig` 与 `GroupPolicy`
  从 schema 推导。页面使用类型导入，避免把数据库和运行时依赖带入浏览器。
- `lib/core/config/env.ts` 将环境变量转换为种子，`migrate.ts` 处理旧格式兼容，
  `chats.ts` 维护通道引用规范化，`patch.ts` 定义接口更新语义。
- `lib/core/config-store.ts` 负责配置读写及存量导入兼容，依赖 `lib/core/config/` 下的各模块、
  `lib/core/db/repositories/config.ts`，以及 `lib/channels/enabled-chats.ts`。新增纯业务规则应放在
  专门模块，便于脱离 Next.js 与数据库测试。
- `lib/core/db/repositories/` 按领域维护 SQL，`Repo` 保留兼容转发，各领域共享连接与事务。
  类型、事务边界和扩展方式见 [数据访问层](data-access.md)。
- `lib/core/db/migrations/` 集中注册并按版本执行结构升级；发布前检查、备份与恢复流程见
  [数据库迁移与备份](database-operations.md)。

## 扩展配置

1. 在 `appConfigSchema` 添加字段、校验、默认值及必要的中文说明，类型与 HTTP
   补丁规则自动跟随。若有环境变量入口，在 `env.ts` 添加对应映射。
2. 在相应配置区块添加编辑控件；数值与时长转换使用现有表单工具。
3. 将新字段接入实际消费者，例如 `runtime.ts` / `assemble.ts`；仅能保存还不算功能完成。
4. 增加业务边界测试，特别是默认值、旧配置缺字段、局部更新与运行时行为。

更新语义必须保持一致：

- 未提交或 `undefined` 的字段表示不修改；不要在局部补丁中补默认值。
- 掩码或空字符串密钥表示保留旧密钥，响应只返回掩码。
- 群策略对象整份替换该群覆盖；`null` 或空对象清除该群覆盖，其他群保持原样。
- 管理面与客服生效会话互斥；使用 `channel + chatId` 比较，TG ID 保留字符串。
- 扫描周期至少 1000ms，最多 `2 ** 31 - 1` ms，避免 Node 将非法周期解释为 1ms。
  整理和升格周期允许 0 关闭，历史负数也按关闭处理。
- `maxReplyChars=0` 表示不拆分；`resumeTtlMs=0` 表示关闭续接过期。
- HTTP 错误类型返回 400；读取旧库和环境变量时按字段回退种子，保留其他有效值。

## 注释与测试

注释使用简体中文，解释设计原因、单位、边界和兼容约定。避免逐行翻译代码，
也不要把历史调试过程留作长期说明。名称应直接表达职责，例如 `updateField`。

测试放在 `tests/`，镜像源码目录。纯规则测试只依赖普通对象；存储边界使用内存
SQLite；HTTP 测试只替换外部运行时，不替换正在验证的配置持久化逻辑。
优先保护用户可感知行为，而非组件数量、函数调用细节或文件行数。

## 后续工程重点

已完成配置链路、数据访问层拆分、事务化迁移与数据库备份校验。商业发布前还需逐项
推进并验证：

- 对知识库和会话等大型页面沿用独立区块与状态管理分离的方式。
- 配置热重载目前先保存再重启，尚需设计失败回滚、并发更新控制和操作审计。
- 将自动备份保留策略、部署回滚和鉴权策略纳入发布验证。

这些项目需要各自的验收与测试，本次重构不代表已完成商业发布评审。
