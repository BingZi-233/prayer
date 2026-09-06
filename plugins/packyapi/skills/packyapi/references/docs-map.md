# PackyAPI 官方文档地图(sitemap 定位)

站点:`https://docs.packyapi.ai`(VuePress,无 llms.txt)。按主题定位到**单个** URL 后再 WebFetch。
刷新全量列表:`curl -s https://docs.packyapi.ai/sitemap.xml | grep -oE '<loc>[^<]+'`

> 本表核对于 2026-09-06。Gemini 的 CLI 配置页与 CC-Switch 页已下线,只剩 FAQ。

## 注册 / 入门 `docs/register/`
| 主题 | URL |
|---|---|
| 注册 | `/docs/register/1-register.html` |
| 登录 | `/docs/register/2-login.html` |
| 充值额度 | `/docs/register/3-quota.html` |
| 创建令牌 token | `/docs/register/4-token.html` |
| **环境变量配置** | `/docs/register/5-env.html` |
| CLI 接入 | `/docs/register/6-cli.html` |

## CLI 配置 `docs/cli/`(接 Claude/Codex 首选看这里)
| 主题 | URL |
|---|---|
| 环境检查(通用步骤) | `/docs/cli/1-env.html` |
| **Claude Code** | `/docs/cli/2-claude.html` |
| Codex | `/docs/cli/3-codex.html` |
| 缓存修复 | `/docs/cli/5-cache-fix.html` |
| Grok Build | `/docs/cli/6-grok-build.html` |
| Kimi Code | `/docs/cli/7-kimi-code.html` |

## CC-Switch 工具 `docs/ccswitch/`
通用 `/1-common.html` · Claude `/2-claude.html` · Codex `/3-codex.html` ·
Claude Desktop `/4-claude-desktop.html` · 用量查询 `/4-usage-query.html` ·
CLI `/5-ccs_cli.html` · Codex App `/6-codex-app.html`

## 令牌与分组 `docs/token/`
简介 `/docs/token/1-intro.html` · 分组说明 `/docs/token/2-group.html`

> 分组页的倍率会滞后于 API。要准确值用 `packy` 工具 `{ "action": "groups" }`。

## 常见问题 `docs/faq/`
Claude Code `/docs/faq/CC.html` · Codex `/docs/faq/Codex.html` ·
Gemini `/docs/faq/Gemini.html` · Grok Build `/docs/faq/GrokBuild.html`

## 进阶接入 `docs/advanced/`
AionUI · AllApiHub · ChatGPTClaudeCode · ClaudeDesktop · DeepSeekClaudeCode ·
DeepSeekCodex · Hermes · OpenClaw · OpenCode · WorkBuddy
(URL 形如 `/docs/advanced/<名>.html`)

## 绘图 `docs/paint/`
Banana `/docs/paint/Banana.html` · GPTImage `/docs/paint/GPTImage.html`

## 其它
监控 `/docs/Monitor.html` · 服务条款 `/docs/tos/TOS.html` ·
AUP `/docs/tos/aup.html` · 使用条款 `/docs/tos/use.html` ·
专项条款 `/docs/tos/service-specific-terms.html`

---
**定价/模型不要查文档** —— 用 `packy` 工具(实时 JSON API,更准更省)。
