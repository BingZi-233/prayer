---
title: Claude Desktop
icon: material-icon-theme:claude
---

## 软件下载

1. 点击 [Claude Desktop下载链接](https://claude.com/download) ，进入下载页面

![](/assets/image/Advanced/ClaudeDesktop/01.webp)

2. 在如上图 `Desktop` 一块，根据自己的系统，下载对应的安装包

## 软件安装

::: tabs

@tab Windows

1. Windows系统下软件安装需要请求Anthropic官方，需要你用梯子挂 **全局服务（TUN模式）** ，或是用命令行来运行安装程序，使其强制走代理，否则会出现以下报错

![](/assets/image/Advanced/ClaudeDesktop/02.webp)

2. 如果出现以上报错无法安装，请在 Claude Desktop安装程序所在目录运行 `cmd` 命令行

3. 确认你当前使用梯子的端口号，比如我使用的是 `Clash Verge` ，则端口号为 `7897`

![](/assets/image/Advanced/ClaudeDesktop/03.webp)

4. 在命令行中分别输入以下命令，运行安装程序，此时能够正常安装

```bash
set HTTP_PROXY=http://127.0.0.1:7897
set HTTPS_PROXY=http://127.0.0.1:7897
"Claude Setup.exe"
```

![](/assets/image/Advanced/ClaudeDesktop/04.webp)

5. 正常安装

![](/assets/image/Advanced/ClaudeDesktop/05.webp)

@tab MacOS

1. MacOS系统下直接正常安装即可

![](/assets/image/Advanced/ClaudeDesktop/06.webp)

:::

## 绕过登录并配置第三方接口

1. 打开软件进入登录界面

![](/assets/image/Advanced/ClaudeDesktop/07.webp)

2. 开启开发者模式

::: tabs

@tab Windows

1. 鼠标点击邮件输入框获取焦点，键盘tab跳到左上角菜单，按下回车依次进入 –> help → troubleshooting → enable developer mode

![](/assets/image/Advanced/ClaudeDesktop/08.webp)

2. 开启 `enable developer mode`

![](/assets/image/Advanced/ClaudeDesktop/09.webp)

@tab MacOS

1. 直接在左上角菜单中依次进入 –> help → troubleshooting → enable developer mode

![](/assets/image/Advanced/ClaudeDesktop/10.webp)

2. 开启 `enable developer mode`

![](/assets/image/Advanced/ClaudeDesktop/09.webp)

3. 等待软件重启

:::

## 配置第三方API

1. 同样的方法打开菜单，依次进入 Developer → Configure third-party inferenc

![](/assets/image/Advanced/ClaudeDesktop/11.webp)

2. 在Gateway base URL填入 `https://www.packyapi.com`

3. 将Gateway auth scheme更改为 `x-api-key`

4. Gateway API key请填入生成的 CC分组 的APIKEY

5. 打开最下方 `Skip login-mode chooser` 选项

![](/assets/image/Advanced/ClaudeDesktop/12.webp)

6. 点击右下角 `Apply locally` 按钮使配置生效

7. 进行愉快的对话吧~

![](/assets/image/Advanced/ClaudeDesktop/13.webp)