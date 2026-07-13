// PM2 进程配置。单进程:Next.js prod server 通过 instrumentation.ts 拉起 OneBot 客服 Agent。
// better-sqlite3(native)+ 单条 NapCat WS 长连接 → 必须 fork 模式、单实例,不可 cluster。
const path = require("path");

module.exports = {
  apps: [
    {
      name: "prayer",
      // 直接调 next 二进制,避开 pnpm 包一层子进程(pm2 停止时能精确杀到 node)
      script: "node_modules/next/dist/bin/next",
      args: "start -H 0.0.0.0 -p 3000",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      // Next 自身加载 .env*;这里仅兜底 NODE_ENV
      env: {
        NODE_ENV: "production",
      },
      error_file: path.join(__dirname, "logs/pm2-error.log"),
      out_file: path.join(__dirname, "logs/pm2-out.log"),
      time: true,
      // 需配合 `pm2 install pm2-logrotate`;模块会读取这些字段做轮转
      max_size: "10M",
      retain: 5,
    },
  ],
};
