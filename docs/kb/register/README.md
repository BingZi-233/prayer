---
title: 快速开始
index: false
icon: fa-solid fa-star-of-david
category:
  - 使用指南
date: 2025-11-23
---

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const isDark = ref(false)

const updateTheme = () => {
  const scheme = localStorage.getItem('vuepress-theme-hope-scheme')
  if (scheme === 'dark') {
    isDark.value = true
  } else if (scheme === 'light') {
    isDark.value = false
  } else {
    isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  }
}

onMounted(() => {
  updateTheme()
  window.addEventListener('storage', updateTheme)
  const observer = new MutationObserver(() => updateTheme())
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})
</script>

<div :class="['important-notice', { dark: isDark }]">
  <div class="notice-glow"></div>
  <div class="notice-header">
    <div class="header-bg-pattern"></div>
    <div class="notice-badge">
      <span class="badge-icon">⚠️</span>
    </div>
    <div class="header-text">
      <span class="notice-label">IMPORTANT</span>
      <span class="notice-title">给阅读者的忠告！</span>
    </div>
    <div class="header-decoration">
      <span class="deco-dot"></span>
      <span class="deco-dot"></span>
      <span class="deco-dot"></span>
    </div>
  </div>
  <div class="notice-content">
    <div class="notice-item" style="--delay: 0s">
      <div class="item-number">01</div>
      <div class="item-body">
        <div class="item-icon-wrap"><span class="item-icon">📖</span></div>
        <span>请你在部署使用前一定去看看 <strong class="highlight-red">模型分组介绍</strong> 与 <strong class="highlight-red">常见问题</strong> 板块，如果有时间最好阅读全文</span>
      </div>
    </div>
    <div class="notice-item" style="--delay: 0.1s">
      <div class="item-number">02</div>
      <div class="item-body">
        <div class="item-icon-wrap"><span class="item-icon">💡</span></div>
        <span>我们一直提倡 <strong class="highlight-blue">"授人以鱼，不如授人以渔"</strong></span>
      </div>
    </div>
    <div class="notice-item" style="--delay: 0.2s">
      <div class="item-number">03</div>
      <div class="item-body">
        <div class="item-icon-wrap"><span class="item-icon">✅</span></div>
        <span>这两个板块不仅能提升你的使用体验，也能解答你今后会在群里提问的 <strong class="highlight-gold">90%</strong> 的问题</span>
      </div>
    </div>
  </div>
  <div class="notice-footer">
    <span class="footer-text">请务必认真阅读以上内容</span>
    <div class="footer-line"></div>
  </div>
</div>

<style>
.important-notice {
  position: relative;
  margin: 32px 0;
  border-radius: 16px;
  overflow: hidden;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  animation: float 3s ease-in-out infinite;
}

.important-notice.dark {
  background: rgba(40, 40, 45, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.3),
    0 2px 8px rgba(0, 0, 0, 0.2);
}

.notice-glow {
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.4) 0%, transparent 40%);
  pointer-events: none;
  animation: glow-rotate 12s linear infinite;
}

.important-notice.dark .notice-glow {
  background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.05) 0%, transparent 40%);
}

@keyframes glow-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

.notice-header {
  position: relative;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(245, 245, 250, 0.9) 100%);
  backdrop-filter: blur(12px);
  padding: 20px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  overflow: hidden;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.important-notice.dark .notice-header {
  background: linear-gradient(135deg, rgba(55, 55, 60, 0.9) 0%, rgba(45, 45, 50, 0.9) 100%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.header-bg-pattern {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(circle at 20% 50%, rgba(0, 0, 0, 0.02) 0%, transparent 25%),
    radial-gradient(circle at 80% 50%, rgba(0, 0, 0, 0.015) 0%, transparent 20%);
  pointer-events: none;
}

.important-notice.dark .header-bg-pattern {
  background-image:
    radial-gradient(circle at 20% 50%, rgba(255,255,255,0.05) 0%, transparent 25%),
    radial-gradient(circle at 80% 50%, rgba(255,255,255,0.03) 0%, transparent 20%);
}

.notice-badge {
  width: 52px;
  height: 52px;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(12px);
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
  animation: badge-pulse 2s ease-in-out infinite;
}

.important-notice.dark .notice-badge {
  background: rgba(80, 80, 85, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

@keyframes badge-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

.badge-icon {
  font-size: 28px;
  animation: shake 1s ease-in-out infinite;
}

@keyframes shake {
  0%, 100% { transform: rotate(0deg); }
  10%, 30%, 50%, 70%, 90% { transform: rotate(-8deg); }
  20%, 40%, 60%, 80% { transform: rotate(8deg); }
}

.header-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.notice-label {
  font-size: 11px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.5);
  letter-spacing: 2px;
  text-transform: uppercase;
}

.important-notice.dark .notice-label {
  color: rgba(255, 255, 255, 0.6);
}

.notice-title {
  font-size: 22px;
  font-weight: 800;
  color: rgba(0, 0, 0, 0.85);
}

.important-notice.dark .notice-title {
  color: rgba(255, 255, 255, 0.95);
}

.header-decoration {
  display: flex;
  gap: 6px;
}

.deco-dot {
  width: 8px;
  height: 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 50%;
  animation: dot-blink 1.5s ease-in-out infinite;
}

.important-notice.dark .deco-dot {
  background: rgba(255, 255, 255, 0.3);
}

.deco-dot:nth-child(2) { animation-delay: 0.2s; }
.deco-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes dot-blink {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.2); }
}

.notice-content {
  background: transparent;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.notice-item {
  display: flex;
  align-items: stretch;
  gap: 0;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  animation: slide-in 0.5s ease-out backwards;
  animation-delay: var(--delay);
}

.important-notice.dark .notice-item {
  background: rgba(60, 60, 65, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

@keyframes slide-in {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.notice-item:hover {
  transform: translateX(8px) scale(1.01);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
  background: rgba(255, 255, 255, 0.7);
}

.important-notice.dark .notice-item:hover {
  background: rgba(70, 70, 75, 0.6);
}

.item-number {
  min-width: 48px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(245, 245, 250, 0.95) 100%);
  color: rgba(0, 0, 0, 0.6);
  font-size: 18px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Courier New', monospace;
  border-right: 1px solid rgba(0, 0, 0, 0.06);
}

.important-notice.dark .item-number {
  background: linear-gradient(180deg, rgba(60, 60, 65, 0.9) 0%, rgba(50, 50, 55, 0.9) 100%);
  color: rgba(255, 255, 255, 0.7);
  border-right: 1px solid rgba(255, 255, 255, 0.08);
}

.item-body {
  flex: 1;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px 20px;
  font-size: 15px;
  line-height: 1.7;
}

.item-icon-wrap {
  width: 36px;
  height: 36px;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(8px);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
}

.important-notice.dark .item-icon-wrap {
  background: rgba(80, 80, 85, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.item-icon {
  font-size: 18px;
}

.highlight-red {
  color: #ff4757;
  font-weight: 700;
  padding: 3px 8px;
  background: linear-gradient(135deg, rgba(255, 71, 87, 0.15) 0%, rgba(255, 71, 87, 0.08) 100%);
  border-radius: 6px;
  border: 1px solid rgba(255, 71, 87, 0.2);
  transition: all 0.2s ease;
}

.highlight-red:hover {
  background: linear-gradient(135deg, rgba(255, 71, 87, 0.25) 0%, rgba(255, 71, 87, 0.15) 100%);
  transform: scale(1.02);
}

.highlight-blue {
  color: #37B4FA;
  font-weight: 700;
  padding: 3px 8px;
  background: linear-gradient(135deg, rgba(55, 180, 250, 0.15) 0%, rgba(55, 180, 250, 0.08) 100%);
  border-radius: 6px;
  border: 1px solid rgba(55, 180, 250, 0.2);
  transition: all 0.2s ease;
}

.highlight-blue:hover {
  background: linear-gradient(135deg, rgba(55, 180, 250, 0.25) 0%, rgba(55, 180, 250, 0.15) 100%);
  transform: scale(1.02);
}

.highlight-gold {
  color: #10b981;
  font-weight: 800;
  font-size: 1.25em;
  padding: 3px 10px;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(16, 185, 129, 0.08) 100%);
  border-radius: 6px;
  border: 1px solid rgba(16, 185, 129, 0.25);
  animation: highlight-glow 2s ease-in-out infinite;
}

@keyframes highlight-glow {
  0%, 100% { box-shadow: 0 0 8px rgba(16, 185, 129, 0.2); }
  50% { box-shadow: 0 0 16px rgba(16, 185, 129, 0.35); }
}

.notice-footer {
  background: linear-gradient(90deg, transparent, rgba(100, 100, 110, 0.1), transparent);
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.footer-text {
  font-size: 12px;
  color: rgba(80, 80, 90, 0.8);
  font-weight: 600;
  letter-spacing: 1px;
}

.important-notice.dark .footer-text {
  color: rgba(200, 200, 210, 0.6);
}

.footer-line {
  flex: 1;
  max-width: 100px;
  height: 2px;
  background: linear-gradient(90deg, rgba(100, 100, 110, 0.4), transparent);
  border-radius: 1px;
}

.important-notice.dark .footer-line {
  background: linear-gradient(90deg, rgba(150, 150, 160, 0.3), transparent);
}
</style>

::: info 让我们从这里开始吧！
从 0 开始的 PackyApi 使用之旅~ 

一步步来，准没问题！
:::

## 第一步：注册账号

- 注册入口：<https://www.packyapi.com/register>

![](/assets/image/QuickStart/001.webp)

- 打开注册入口后，点击页面右上角的“注册”。
- 如果你在登录页，也可以点击底部“没有账户？注册”进入注册流程。

**方式一（推荐）：使用 Google 账号注册**

1. 点击“使用 Google 继续”。
2. 在弹窗中选择要绑定的 Google 账号并完成授权。
3. 授权成功后，系统会自动创建账号并登录。

使用 Google 注册无需额外设置密码，后续登录时继续选择同一个 Google 账号即可。

**方式二：使用邮箱注册**

1. 点击“使用用户名注册”。
2. 填写邮箱、用户名和密码。
3. 按页面提示提交，完成注册。

:::warning
邮箱会用于接收验证与通知；密码建议使用字母、数字和特殊字符组合。请妥善保管登录凭证，避免账号被盗用。
:::

## 第二步：登录账号

- 登录入口：<https://www.packyapi.com/login>

![](/assets/image/QuickStart/001.webp)

**使用 Google 账号登录**

1. 点击“使用 Google 继续”。
2. 选择注册时绑定的 Google 账号。
3. 授权成功后即可自动登录。

**使用邮箱/用户名登录**

1. 输入邮箱地址或用户名。
2. 输入账号密码。
3. 点击“继续”完成登录。

::: info 设备登录说明
浏览器会保持登录状态；在新设备需重复登录流程。
:::

如果点击“使用 Google 继续”后出现“错误：OIDC 获取 Token 失败，请检查设置！”，通常是浏览器缓存或 Cookie 状态异常导致。

![](/assets/image/QuickStart/002.webp)

可以先清空浏览器缓存后重试：

- Windows / Linux Chrome：按 `Ctrl + Shift + Delete` 打开清除浏览数据页面。
- macOS Chrome：按 `Command + Shift + Delete` 打开清除浏览数据页面。

如果清理缓存后仍然无效，请手动删除 `packyapi.com` 相关 Cookie：

1. 在登录页按 `F12` 打开开发者工具。
2. 进入“应用”面板。
3. 在左侧依次选择“存储” → “Cookie” → `https://www.packyapi.com`。
4. 删除 `session`、`TDC_itoken` 等站点 Cookie 后刷新页面，再重新登录。

![](/assets/image/QuickStart/006.webp)


## 第三步：购买额度

登录控制台后，进入左侧“钱包管理”页面购买额度。

1. 在“选择充值额度”中选择固定额度，或在“自定义额度”中输入要充值的金额。
2. 确认页面下方的“实付金额”后，点击“立即支付”。

::: info 支付说明
目前充值比例为 `1:1`，即 **1 元人民币等同于 1 美元额度**。如果使用支付宝或微信支付时没有弹出支付页面，请先关闭代理后重试。
:::

::: warning 临时公告：开票服务调整
为配合近期结算与服务流程调整，PackyAPI 的开票服务将按支付主体与订单时间做阶段性调整：

- 个人支付订单当前仅支持开具海外 Invoice。
- 5 月已完成支付的订单，所有用户仍可在 6 月申请补开大陆发票；其中海外 Invoice 订单需完成补税后申请，申请截止至 6 月 15 日。
- 自 6 月起，新购个人支付订单不再支持开具大陆发票；后续大陆发票仅支持企业对公支付订单。
:::

## 第四步：创建 API 令牌

登录后进入控制台面板，左侧选择“令牌管理”。

![](/assets/image/QuickStart/004.webp)

### 进入令牌管理

1. 在左侧菜单点击“令牌管理”。
2. 点击页面上方的“添加令牌”。

### 创建新令牌

在弹窗中填写令牌信息：

![](/assets/image/QuickStart/005.webp)

- 令牌名称：用于区分不同用途，例如 `Claude Code`、`Codex`、`Gemini`。
- 令牌分组：必须选择，分组决定这个令牌可以使用哪些模型。
- 过期时间：默认“永不过期”，也可以按需要设置有效期。
- 新建数量：一般保持 `1` 即可。
- 额度设置：开启“无限额度”时，令牌实际可用额度仍受账户余额限制。
- 访问限制：不熟悉时建议先保持默认，不要开启模型限制或 IP 白名单。

::: warning 令牌分组一定要选对
令牌分组会直接影响可用模型。比如 Claude Code、Codex、Gemini CLI 需要选择对应分组；如果分组选错，后续配置 CLI 时很容易出现“模型不存在”或无法调用的问题。

如果你不确定每个分组适合什么场景，请先阅读 [PackyAPI 各分组介绍](/docs/token/)。
:::

填写完成后，点击右下角“提交”完成创建。

### 查看分组可用模型

你可以在“模型广场”查看每个令牌分组下支持哪些模型。

![](/assets/image/QuickStart/008.webp)

1. 点击页面右上角“模型广场”。
2. 在左侧“可用令牌分组”中选择分组。
3. 右侧模型卡片会显示该分组可用的模型、价格和折扣倍率。

![](/assets/image/QuickStart/007.webp)

如果你想了解折扣含义，可以点击模型广场右上方的“折扣说明”。

## 第五步：环境检查

在配置 Claude Code、Codex 或 Gemini CLI 之前，请先确认本机已经正确安装 Node.js。

在 Windows、macOS 或 Linux 终端中执行：

```bash
npm list -g --depth-0
```

如果命令可以正常执行，说明 Node.js 与 npm 已经可用。即使输出中没有安装任何全局包，也不影响后续配置。

如果提示“命令未找到”或类似错误，说明当前环境还没有安装 Node.js，或安装后没有正确加入系统环境变量。请先完成 Node.js 安装，再重新执行上面的命令确认。

::: warning 必须先完成环境检查
CLI 工具依赖 Node.js 和 npm。环境没有准备好时，后续安装 Claude Code、Codex、Gemini CLI 都可能失败。
:::

## 第六步：配置 CLI 工具

PackyAPI 支持在命令行中使用 Claude Code、Codex、Gemini CLI

### 基础条件

开始配置 CLI 前，请先完成以下步骤：

1. 完成 [环境检查](/docs/register/5-env.html)，确保 Node.js 和 npm 可以正常使用。
2. 完成 [安装 CLI](/docs/cli/1-env.html#_2-安装cli)，安装 Claude Code、Codex、Gemini CLI。

### API 端点说明

登录控制台后，可以在“数据看板”右侧查看当前可用的 API Endpoint。

![](/assets/image/QuickStart/009.webp)

- 主站 Endpoint：`https://www.packyapi.com`，稳定可靠，适合生产环境。
- 优化线路 Endpoint：`https://api-slb.packyapi.com`，优化线路，适合对延迟敏感的场景。

::: warning OpenAI 兼容端点需要添加 `/v1`
如果你使用的是 OpenAI 兼容格式的客户端或工具，例如 Codex、OpenAI SDK、Cherry Studio 的 OpenAI 兼容配置，请在 API 地址后添加 `/v1`：

```bash
https://www.packyapi.com/v1
https://api-slb.packyapi.com/v1
```

如果使用的是 Claude Code、Gemini CLI 等专用配置，请以对应教程中的示例为准。
:::

::: important 推荐配置
为了让配置过程进行轻便简单，我们**极力推荐**使用Github开源项目 [CC-Switch](https://github.com/farion1231/cc-switch)来对我们的使用环境进行配置。

[CC-Switch配置CC、Codex、Gemini教程](/docs/ccswitch/)

如果你是老鸟，或者不愿意使用此工具，可以参考以下CLI配置教程文档，**但我们还是极力推荐使用此工具，能省很多时间！**
:::

::: info CLI 手动配置教程传送门

注意：不管你是使用哪个 CLI，请一定先完成上方基础条件，确保 Node.js、npm 和对应 CLI 都可以正常使用。

[Claude Code配置教程](/docs/cli/2-claude.html)

[Codex配置教程](/docs/cli/3-codex.html)

[Gemini配置教程](/docs/cli/4-gemini.html)
:::
