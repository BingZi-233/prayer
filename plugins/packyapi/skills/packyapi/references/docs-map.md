# PackyAPI 官方文档地图(sitemap 定位)

站点:`https://docs.packyapi.ai`(VuePress,无 llms.txt)。按主题定位到**单个** URL 后再 WebFetch。
刷新全量列表:`curl -s https://docs.packyapi.ai/sitemap.xml | grep -oE '<loc>[^<]+'`

## 注册 / 入门 `docs/register/`
| 主题 | URL |
|---|---|
| 注册 | `/docs/register/1-register.html` |
| 登录 | `/docs/register/2-login.html` |
| 充值额度 | `/docs/register/3-quota.html` |
| 创建令牌 token | `/docs/register/4-token.html` |
| **环境变量配置** | `/docs/register/5-env.html` |
| CLI 接入 | `/docs/register/6-cli.html` |

## CLI 配置 `docs/cli/`(接 Claude/Codex/Gemini 首选看这里)
| 主题 | URL |
|---|---|
| 通用环境变量 | `/docs/cli/1-env.html` |
| **Claude Code** | `/docs/cli/2-claude.html` |
| Codex | `/docs/cli/3-codex.html` |
| Gemini CLI | `/docs/cli/4-gemini.html` |
| 缓存修复 | `/docs/cli/5-cache-fix.html` |

## CC-Switch 工具 `docs/ccswitch/`
通用 `/1-common.html` · Claude `/2-claude.html` · Codex `/3-codex.html` · Gemini `/4-gemini.html` · CLI `/5-ccs_cli.html`

## 令牌与分组 `docs/token/`
简介 `/docs/token/1-intro.html` · **分组说明** `/docs/token/2-group.html`

## 常见问题 `docs/faq/`
Claude Code `/docs/faq/CC.html` · Codex `/docs/faq/Codex.html` · Gemini `/docs/faq/Gemini.html`

## 进阶接入 `docs/advanced/`
AionUI · ChatGPTClaudeCode · ClaudeDesktop · DeepSeekClaudeCode · Hermes · OpenClaw · OpenCode
(URL 形如 `/docs/advanced/<名>.html`)

## 绘图 `docs/paint/`
Banana `/docs/paint/Banana.html` · GPTImage `/docs/paint/GPTImage.html`

## 其它
监控 `/docs/Monitor.html` · 服务条款 `/docs/tos/TOS.html`

---
**定价/模型不要查文档** —— 用 `/packy-price`、`/packy-models`(实时 JSON API,更准更省)。
