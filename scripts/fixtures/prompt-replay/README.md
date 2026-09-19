# prompt-replay 变体 fixture

`scripts/prompt-replay.ts` 的对比基准。这里是**历史/对照文本**,不是运行时资产:
脚本只读它们,系统任何一个环节都不加载。

| 文件 | 是什么 | sha256 |
| --- | --- | --- |
| `old.txt` | 2026-09-19 弱模型适配**改动前**的主客服 system prompt 正文 | `a1922faaf8cbd6a7b200b1bee4c794627578a3d3258ffa96070f6d794d6224ec` |
| `a.txt` | 方案 A 基线:更短、**无首尾强化**(关键铁律不在开头/结尾各说一遍) | `dfc1d7a6ea672d7750baecb71b0e1cab6b6baae6e25129cde845b27e96883306` |

另有一个不出现在本目录的变体:`clite` = 当前的 `lib/model/system-prompt.ts`
(`buildDefaultSystem`),由脚本现场渲染,不需要 fixture 文件。

## 占位符

两个文件都不是可直接投喂的正文,渲染由 `scripts/prompt-replay.ts` 的 `renderVariant`
完成,替换四类占位符:

- `${BRAND}` → `app` 配置里的 `brandName`
- `${DESC}` → `app` 配置里的 `brandDescription`
- `${HINT}` → 按 `supportUrl` 分支算好的 supportHint(见下)
- `${KB_CANDIDATES_BEGIN}` `${KB_CANDIDATES_END}` `${USER_MESSAGE_BEGIN}`
  `${USER_MESSAGE_END}` → `lib/model/prompt.ts` 里同名常量的值
  (`<<<SYSTEM_KB_CANDIDATES>>>` / `<<<END_SYSTEM_KB_CANDIDATES>>>` /
  `<<<UNTRUSTED_CUSTOMER_MESSAGE>>>` / `<<<END_UNTRUSTED_CUSTOMER_MESSAGE>>>`)

`${HINT}` 代表已按 supportUrl 分支算好的 supportHint:supportUrl 有值时给「这类事务
可引导用户访问 <url> 自助查看或办理,或在本群 @我 后发送「人工」转接群管。」,为空时给
「这类事务无法由自动客服办理,应如实说明并引导用户在本群 @我 后发送「人工」联系群管。」。
旧代码里 `${supportUrl}` 只出现在这段三元里、位于模板正文之外,故变体文本不含
`${SUPPORT_URL}` —— 渲染器自己算这个 hint。

## 重新生成 old.txt

`old.txt` 是 `git show 3a9456f:lib/model/system-prompt.ts` 里 `buildDefaultSystem`
模板正文的逐字节副本,只把 `${brand.name}` / `${brand.description}` / `${supportHint}`
归一化成 `${BRAND}` / `${DESC}` / `${HINT}`(四个 marker 常量的插值写法本就等于占位符名,
无需改写)。重生成命令(在仓库根执行):

```bash
git show 3a9456f:lib/model/system-prompt.ts | node -e '
const src = require("fs").readFileSync(0, "utf8")
const start = src.indexOf("return `") + "return `".length
const end = src.indexOf("`\n}", start)
process.stdout.write(
  src.slice(start, end)
    .split("${brand.name}").join("${BRAND}")
    .split("${brand.description}").join("${DESC}")
    .split("${supportHint}").join("${HINT}")
)
' > scripts/fixtures/prompt-replay/old.txt
```

`3a9456f` 是弱模型适配动工前的最后一个 system prompt 版本(`docs(prompt): 弱模型适配实施计划`)。

`a.txt` 是当时手写的对照基线,没有对应的 git 版本——不要在历史里找它的出处,也不要用上面
的命令重生成它。要改它的内容,只能直接改文件并同步本表里的 sha256。

## 变更须知

改这两个文件等于改对比基准,会让历史回放报告不可复现。动之前先确认确实要换基准,
改完同步更新上表 sha256。
