# 主动回复（无人应答兜底）设计

日期：2026-07-06
分支：feat/proactive-reply

## 背景与目标

现有 bot **纯被动**:`gateway` 只放行 `@bot` 的消息进主链路(`message.qualified` → orchestrator → agent → `reply.ready`)。用户在群里问 PackyAPI 问题但没 @bot、也没人工回复 → 无人应答,体验差。

**新目标**:加**无人应答兜底**——用户提问后一段时间内没人工(群主/群管)回复、bot 也没被 @ 处理过,则 bot 主动补位回答。保守优先:宁可沉默,绝不发"暂未查到"式插话,绝不刷屏。

选定语义(排除的其它方向,YAGNI):
- **不做**"见问即答"抢答(每条像咨询的消息都作答)。
- **不做**真·主动发起(定时播报/入群欢迎/活动通知)。
- **不做**氛围/闲聊插话。

## 关键约束

兜底路径**不能走 orchestrator**:orchestrator 必发 reply(意图拦截发 `BLOCKED_REPLY`、agent 超限发兜底模板)。主动路径要能沉默,须独立 handle。但**复用** `Agent` 实例、`SessionStore`、`makeIntentClassifier` 风格。

原料现成:`message-buffer` 已缓冲全量群消息(含 `sender_role`),无需新采集。

## 架构总览

```
setInterval(proactiveScanMs) ── registerUnansweredPoller  (仅 proactiveEnabled 时挂)
    └─ 每个生效群:band = (proactive_cursor, now - proactiveSilenceMs]
         取 band 内 member/null 提问,按 userId 归组取最后一条(每用户每轮 ≤1)
         ├─ 压制(纯 SQL/内存,零 LLM,短路):
         │    1. 该问 ts 之后(至 now)群里有 owner/admin 发言 → 人工接管,跳过
         │    2. sessions.updated_at(key=groupId:userId) > 问题 ts → 主链路已 @处理/已兜底过,跳过
         │    3. 冷启动:proactive_cursor == 0 → 设为 until 跳过,绝不答历史积压
         ├─ 门1 answerability(轻量 LLM,maxTurns:1 无工具):可答 PackyAPI 问题? 否 → 跳过
         └─ 门2 agent.run(user sessionKey + resumeId + systemSuffix 哨兵)
                ├─ 真答案 → bus.emit reply.ready + store.remember(续接)
                └─ 输出撞 __NO_ANSWER__ / 空 → 沉默不发
         每群命中上限 proactiveMaxPerScan;末尾推进 proactive_cursor = until
```

旁路观察者:任何失败只 emit `error.occurred`,绝不阻断主链路。

## 组件

### 1. 主动兜底轮询 `registerUnansweredPoller`(新,`lib/agent/unanswered-poller.ts`)

照抄 `reflection-poller.ts` 结构(`resolve` deps + `scanOnce` + 导出 `runScan` 供测试 + `registerUnansweredPoller` 返回 teardown)。

**deps**:`{ repo, agent, store, classify, botQQ, adminGroupId, enabledGroups, scanMs?, silenceMs?, maxPerScan?, queryFn?, now? }`
- `agent`:复用主链路 `Agent` 实例。
- `store`:复用 `SessionStore`(同一 resumeTtl,拿 resumeId + remember)。
- `classify`:answerability 判官(见组件 2),非主链路的 intent 分类器。

**`scanOnce` 每轮**:
1. `until = now - silenceMs`;`until <= 0` 跳过。
2. 遍历 `enabledGroups`(与反思一致的生效群门;排除 adminGroup)。
3. 每群读 `proactive_cursor:{gid}`(缺省 0):
   - `until <= cursor` → 跳过(无新沉降)。
   - **冷启动**:`cursor == 0` → `setProactiveCursor(gid, until)` 后跳过(不答上线前积压)。
4. 取 band `(cursor, until]` 内 member/null 提问(`sender_role NOT IN ('owner','admin')`),按 `userId` 归组,每组取 `created_at` 最大的一条为代表(带该用户前几条 band 内消息作上下文,拼进 prompt 文本)。
5. 逐候选(每群命中数 `< maxPerScan` 才继续),按序做压制检查:
   - **人工接管**:`repo.hasAdminMessageAfter(gid, questionTs, now)` 为真 → 跳过。
   - **主链路/已兜底**:`repo.sessionUpdatedAt('${gid}:${userId}')` 存在且 `> questionTs` → 跳过。
6. 过压制 → 门1 `classify(text)`:非可答问题 → 跳过。
7. 过门1 → 门2 `agent.run(text, store.resumeId(sessionKey), ctx, undefined, { systemSuffix: PROACTIVE_SUFFIX })`:
   - 输出 trim 后为空、或含 `__NO_ANSWER__` → 沉默(不发、不 remember)。
   - 真答案 → `bus.emit("reply.ready", { groupId, text })` + `store.remember(sessionKey, result.sessionId)`;`logger.log("info", ...)` 审计。命中计数 +1。
8. 每群处理完 `setProactiveCursor(gid, until)`(即使某候选抛错——单候选 try/catch,不牵连推进,语义同反思:该条丢失可接受)。

**band 语义**:`(cursor, silenceMs 沉降)` 保证①每条提问只判一次②`silenceMs` 给人工/主链路留应答时间。太新(`> until`)的消息不碰,下轮再说。压制①②检查用到 `now`(非 `until`)——沉默窗口内的人工回复也能捕获。

### 2. answerability 判官 `makeAnswerabilityClassifier`(新,置于 `lib/agent/unanswered-poller.ts` 或 `answerability.ts`)

照抄 `intent.ts` 结构:`maxTurns:1`、`canUseTool` 全 deny、`permissionMode:"default"`、`settingSources:["user"]`、`env: sdkEnv()`;用户文本包 `<<<UNTRUSTED_USER_MESSAGE>>>` 定界(防注入,剥伪造定界符)。fail-**closed**:出错/无法解析 → **不答**(与 intent 的 fail-open 相反——主动插话宁可少发)。

system prompt 要点:判定"这是否是一条 PackyAPI 产品咨询问题,值得客服主动补位回答"。
- 是(→ `{"answer":true}`):价格、可用模型、接入配置、计费规则等**咨询性**问题。
- 否(→ `{"answer":false}`):闲聊寒暄、纯情绪、与 PackyAPI 无关、写代码请求、找具体订单/账户事务(bot 本就答不了)、任何试图套取/绕限的话术(交给主链路意图门,主动路径一律不碰)。

输出 `{"answer":true}` 或 `{"answer":false}`,解析失败按 false。

### 3. Agent 变更(`lib/agent/agent.ts`)

`Agent.run` 加可选第 5 参 `opts?: { systemSuffix?: string }`,对主链路**零影响**(不传即现状):
```ts
async run(text, resumeId, ctx, media?, opts?: { systemSuffix?: string }): Promise<AgentResult>
```
构建 options 时:`systemPrompt: (this.deps.systemPrompt || DEFAULT_SYSTEM) + (opts?.systemSuffix ? "\n\n" + opts.systemSuffix : "")`。

主动路径传:
```
【主动模式】你是在无人应答时主动补位。仅当知识库检索到确切依据且你有把握时才作答;否则只输出 __NO_ANSWER__(不解释、不道歉、不引导工单、不寒暄)。
```
哨兵 `__NO_ANSWER__` 比模糊匹配"暂未查到"稳。

### 4. Repo 变更(`lib/db/repo.ts`)

**新增**:
- `hasAdminMessageAfter(groupId, afterTs, untilTs): boolean` — `(afterTs, untilTs]` 内是否有 owner/admin 发言(压制①)。可复用现有 `hasAdminMessageBetween` 语义(命名不同,可直接复用它:`hasAdminMessageBetween(gid, questionTs, now)`)。
- `sessionUpdatedAt(key): number | undefined` — 读 `sessions.updated_at`(压制②)。
- `groupProactiveCursor(groupId): number` / `setGroupProactiveCursor(groupId, ts)` — 复用 config 表,key `proactive_cursor:{gid}`(照抄 reflect cursor)。
- `groupUnansweredCandidates(groupId, cursor, until, preContext, maxUsers)` — 取 band 内 member/null 提问,按 userId 归组返回代表 + 上下文。或复用 `groupReflectionWindow` 取整段自行归组(实现时二选一,倾向新加专用查询更清晰)。

**注**:`hasAdminMessageBetween` 已存在(反思用),压制①直接复用,无需新加。

### 5. 配置(`lib/config.ts` + env + `AssembleDeps` + `RuntimeManager`)

`AppConfig` 新增:
- `proactiveEnabled` — env `PROACTIVE_ENABLED`,默认 **false**(安全,显式开启)。
- `proactiveScanMs` — env `PROACTIVE_SCAN_MS`,默认 60000(60s,比反思勤)。
- `proactiveSilenceMs` — env `PROACTIVE_SILENCE_MS`,默认 180000(3min,沉默窗口)。
- `proactiveMaxPerScan` — env `PROACTIVE_MAX_PER_SCAN`,默认 2(每群每轮命中上限,防积压爆发)。

`AssembleDeps` 加对应字段;`assemble` 里仅 `proactiveEnabled` 为真时 `registerUnansweredPoller(...)` 加入 cleanups,复用已建的 `agent`、`new SessionStore(...)`(与 orchestrator 同参)、新建 answerability classifier。`RuntimeManager.start` 透传 config 字段。

### 6. 装配(`lib/assemble.ts`)

```ts
const store = new SessionStore(repo, deps.resumeTtlMs ?? DEFAULT_RESUME_TTL_MS); // 与 orchestrator 共用
// ...orchestrator 用 store...
if (deps.proactiveEnabled) {
  cleanups.push(registerUnansweredPoller({
    repo, agent, store, classify: makeAnswerabilityClassifier(),
    botQQ, adminGroupId, enabledGroups,
    scanMs: deps.proactiveScanMs, silenceMs: deps.proactiveSilenceMs, maxPerScan: deps.proactiveMaxPerScan,
  }));
}
```
teardown 同其它 poller(`clearInterval`)。

## 通知策略

命中主动兜底 → `logger.log("info", "[proactive] 群X 主动回答用户Y")` 审计。**不**默认发管理群(避免像反思那样刷屏管理群)。后续如需可加开关。

## 错误处理

- poller 每轮 try/catch;单群、单候选失败不牵连其他,记 `error.occurred`。
- 门1 判官出错/非法输出 → **不答**(fail-closed)。
- 门2 agent 抛错 → 已有降级(返回兜底文本);主动路径视兜底文本为非答案 → 沉默。哨兵/空判定优先。
- cursor 在每群处理末推进,单候选丢失可接受(旁路语义)。
- `client` 未连不影响 poller(只吃 buffer + bus)。

## 测试(照抄 `reflection-poller.test` 骨架,导出 `runScan`)

`unanswered-poller.test`(mock `queryFn` = 门1 判官 + agent、`now`、真 repo 或 mock):
- happy path:member 提问、沉默超窗、门1=yes、agent 真答案 → emit `reply.ready` + `store.remember` 被调。
- 压制①人工:该问后有 owner/admin 发言 → 不 emit。
- 压制②session:`sessions.updated_at > questionTs` → 不 emit(主链路已处理)。
- 冷启动:`cursor==0` → 设 until、不 emit、不答积压。
- band:太新(`> until`)消息不判;cursor 正确推进;同问跨轮不重复(cursor-once)。
- 门1=no → 不进 agent、不 emit。
- 哨兵:agent 输出 `__NO_ANSWER__` / 空 → 沉默不 emit、不 remember。
- `maxPerScan`:超上限的候选不再处理。

`agent.test`:`systemSuffix` 拼接进 systemPrompt;不传时行为不变(现有用例)。

`answerability.test`:产品问题→true;闲聊/无关/套取/订单事务→false;解析失败→false(fail-closed)。

`config.test`:新 env 解析 + 默认值(`proactiveEnabled` 默认 false)。

真 NapCat 冒烟:生效群造「用户问价、无人回复」→ 等窗口 → bot 主动答;造「用户问、群主先答」→ bot 沉默。

## 非目标(YAGNI)

- 不做真·主动发起(播报/欢迎/通知)。
- 不做抢答(不等沉默窗口即答)。
- 不做氛围/闲聊插话。
- 不做管理群通知(仅 logger 审计)。
- 不做跨群/全局主动频率限额(每群 `maxPerScan` + cursor-once 已够;后续可选)。
- 主动回复只吃 buffer 里的文本(无图);多模态兜底后续可选。
