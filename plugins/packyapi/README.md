# packyapi 插件

快速查询 [PackyAPI](https://www.packyapi.com) 模型价格、可用模型 ID、分组倍率与官方文档。
全走公开 JSON API(`/api/pricing`),不抓 HTML —— 省 token、更精确。

## 命令

| 命令 | 作用 |
|---|---|
| `/packy-price [关键词] [--group cc]` | 查计价($/1M tokens) |
| `/packy-models [--endpoint anthropic]` | 列可用模型 ID |
| `/packy-docs <主题>` | 定位并读单个官方文档页 |

## 直接用脚本

```bash
python3 plugins/packyapi/scripts/packy.py price claude
python3 plugins/packyapi/scripts/packy.py models --endpoint anthropic
python3 plugins/packyapi/scripts/packy.py groups
```

## 安装(Claude Code)

本插件在 `prayer` repo 内。让 Claude Code 识别:

- 项目级:在 `.claude/settings.json` 配置本地 marketplace 指向 `plugins/`,或
- 直接把 `plugins/packyapi` 软链到 `~/.claude/plugins/`。

依赖:`python3`(标准库,无第三方包)。
